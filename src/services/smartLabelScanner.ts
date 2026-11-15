import { createWorker } from 'tesseract.js';
import { Html5Qrcode } from 'html5-qrcode';
import { extractLastFourDigits, normalizeColombianPhone } from '../db/database';
import {
  parseIMileLabelBlock,
  isValidCleanRecipientName,
  normalizeCleanMedellinAddressString,
  sanitizeExtractedHumanText,
} from '../utils/addressParser';
import { sanitizeTrackingInput } from '../utils/formatters';
import {
  getGeminiClientMetadata,
  inferMedellinComunaAndNormalizeAddress,
} from './aiCopilotService';
import {
  invokeGeminiWithFreeTierRouter,
  getQuotaGuardrailSnapshot,
} from './geminiModelRouter';
import {
  recallFromLearnedMemory,
  buildFewShotPromptExamples,
  applyLearnedThermalOcrFixes,
} from './labelLearningEngine';

const GEMINI_API_KEY_STORAGE = 'miruta_gemini_api_key';

export interface SmartVisionConfig {
  geminiApiKey: string;
  projectId: string;
  hasAiVisionKey: boolean;
  modeLabel: string;
}

export interface SmartLabelScanResult {
  trackingNumber: string;
  lastFourDigits: string;
  recipientName: string;
  recipientPhone: string;
  rawAddress: string;
  neighborhood: string;
  comunaName?: string;
  terrainWarning?: string;
  engineUsed:
    | 'learned_memory_recall'
    | 'hybrid_ai_vision'
    | 'offline_tesseract_ocr'
    | 'barcode_only';
  engineBadge: string;
  durationMs: number;
  previewDataUrl: string;
  rawOcrText?: string;
  fieldsDetectedCount: number;
  rotationUsedDeg?: number;
  recalledFromMemory?: boolean;
}

export type ScanStageCallback = (stageMessage: string, progressPercent?: number) => void;

export function getSmartVisionConfig(): SmartVisionConfig {
  const meta = getGeminiClientMetadata();
  const quota = getQuotaGuardrailSnapshot();
  return {
    geminiApiKey: meta.apiKey,
    projectId: meta.projectId,
    hasAiVisionKey: meta.hasKey,
    modeLabel: meta.hasKey
      ? `🟢 Router IA Free-Tier (${quota.activeRecommendedModel} • Costo $0 Garantizado)`
      : '⚡ Motor Local Aprendido + Multi-Ángulo (100% Gratis y Offline)',
  };
}

export function saveSmartVisionApiKey(apiKey: string): void {
  if (typeof window === 'undefined') return;
  const clean = apiKey.trim();
  if (clean) {
    localStorage.setItem(GEMINI_API_KEY_STORAGE, clean);
  } else {
    localStorage.removeItem(GEMINI_API_KEY_STORAGE);
  }
}

/**
 * Rota un HTMLCanvasElement en 90° CW o 270° CCW para leer etiquetas iMile verticales.
 */
function rotateCanvas(
  sourceCanvas: HTMLCanvasElement,
  angleDeg: 90 | 270
): HTMLCanvasElement {
  const rotated = document.createElement('canvas');
  rotated.width = sourceCanvas.height;
  rotated.height = sourceCanvas.width;
  const ctx = rotated.getContext('2d');
  if (!ctx) return sourceCanvas;

  ctx.save();
  if (angleDeg === 90) {
    ctx.translate(rotated.width, 0);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(0, rotated.height);
    ctx.rotate((3 * Math.PI) / 2);
  }
  ctx.drawImage(sourceCanvas, 0, 0);
  ctx.restore();
  return rotated;
}

/**
 * Aplica pre-procesamiento de alto contraste en escala de grises a un canvas para OCR de etiquetas térmicas.
 */
function createHighContrastOcrDataUrl(sourceCanvas: HTMLCanvasElement): string {
  const ocrCanvas = document.createElement('canvas');
  ocrCanvas.width = sourceCanvas.width;
  ocrCanvas.height = sourceCanvas.height;
  const ocrCtx = ocrCanvas.getContext('2d');
  if (!ocrCtx) return sourceCanvas.toDataURL('image/jpeg', 0.9);

  ocrCtx.drawImage(sourceCanvas, 0, 0);
  try {
    const imgData = ocrCtx.getImageData(0, 0, ocrCanvas.width, ocrCanvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const contrast = 1.48;
      let adjusted = (lum - 128) * contrast + 128;
      if (adjusted > 188) adjusted = 255;
      else if (adjusted < 72) adjusted = 0;
      const val = Math.max(0, Math.min(255, Math.round(adjusted)));
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
    }
    ocrCtx.putImageData(imgData, 0, 0);
  } catch {
    // Fallback si canvas no permite getImageData
  }
  return ocrCanvas.toDataURL('image/jpeg', 0.92);
}

/**
 * Convierte cualquier fuente de imagen (File, Blob, HTMLVideoElement, DataURL)
 * en versiones optimizadas a 0°, 90° CW y 270° CCW.
 */
export async function prepareLabelImagesFromSource(
  source: File | Blob | HTMLVideoElement | string
): Promise<{
  previewDataUrl: string;
  ocrProcessedDataUrl: string;
  ocrRotated90DataUrl: string;
  ocrRotated270DataUrl: string;
  canvasElement: HTMLCanvasElement;
  canvasRotated90: HTMLCanvasElement;
}> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo inicializar el motor gráfico Canvas 2D.');
  }

  let width = 1000;
  let height = 1000;

  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    width = source.videoWidth || 1280;
    height = source.videoHeight || 720;
    const maxDim = 1280;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(source, 0, 0, width, height);
  } else {
    const img = await loadImageElement(source as File | Blob | string);
    width = img.naturalWidth || img.width || 1200;
    height = img.naturalHeight || img.height || 900;
    const maxDim = 1280;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, 0, 0, width, height);
  }

  const previewDataUrl = canvas.toDataURL('image/jpeg', 0.88);
  const ocrProcessedDataUrl = createHighContrastOcrDataUrl(canvas);

  const canvas90 = rotateCanvas(canvas, 90);
  const canvas270 = rotateCanvas(canvas, 270);

  const ocrRotated90DataUrl = createHighContrastOcrDataUrl(canvas90);
  const ocrRotated270DataUrl = createHighContrastOcrDataUrl(canvas270);

  return {
    previewDataUrl,
    ocrProcessedDataUrl,
    ocrRotated90DataUrl,
    ocrRotated270DataUrl,
    canvasElement: canvas,
    canvasRotated90: canvas90,
  };
}

function loadImageElement(source: File | Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let objectUrlToRevoke: string | null = null;

    img.onload = () => {
      if (objectUrlToRevoke) URL.revokeObjectURL(objectUrlToRevoke);
      resolve(img);
    };
    img.onerror = () => {
      if (objectUrlToRevoke) URL.revokeObjectURL(objectUrlToRevoke);
      reject(new Error('No se pudo cargar la imagen de la etiqueta.'));
    };

    if (typeof source === 'string') {
      img.src = source;
    } else {
      objectUrlToRevoke = URL.createObjectURL(source);
      img.src = objectUrlToRevoke;
    }
  });
}

function dataUrlToFile(dataUrl: string, fileName: string): File {
  const arr = dataUrl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bstr = atob(arr[1] || '');
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], fileName, { type: mime });
}

/**
 * CAPA 1: Detección de Código de Barras por Hardware Nativo (`window.BarcodeDetector`)
 * + Fallback Multi-Ángulo (0° y 90°) con `Html5Qrcode`.
 */
export async function detectBarcodeLayer1(
  canvases: HTMLCanvasElement[],
  dataUrlsForFallback: string[]
): Promise<string> {
  // 1A. Intentar con API nativa de hardware de Android Chrome (`window.BarcodeDetector`)
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const BarcodeDetectorClass = (
        window as unknown as {
          BarcodeDetector: new (opts: { formats: string[] }) => {
            detect: (
              src: HTMLCanvasElement
            ) => Promise<Array<{ rawValue?: string }>>;
          };
        }
      ).BarcodeDetector;

      const detector = new BarcodeDetectorClass({
        formats: ['code_128', 'code_39', 'ean_13', 'qr_code', 'itf', 'codabar'],
      });

      for (const c of canvases) {
        const results = await detector.detect(c);
        if (results && results.length > 0) {
          for (const item of results) {
            const cleaned = sanitizeTrackingInput(item.rawValue || '');
            if (cleaned.length >= 10) {
              return cleaned;
            }
          }
        }
      }
    } catch {
      // Continuar a Html5Qrcode fallback
    }
  }

  // 1B. Fallback universal con Html5Qrcode probando orientaciones 0° y 90°
  const tempId = 'miruta-smart-temp-qr-reader';
  let tempDiv = document.getElementById(tempId);
  if (!tempDiv && typeof document !== 'undefined') {
    tempDiv = document.createElement('div');
    tempDiv.id = tempId;
    tempDiv.style.display = 'none';
    document.body.appendChild(tempDiv);
  }

  try {
    const qr = new Html5Qrcode(tempId);
    for (let i = 0; i < dataUrlsForFallback.length; i++) {
      try {
        const fileToScan = dataUrlToFile(dataUrlsForFallback[i], `imile-angle-${i}.jpg`);
        const decoded = await qr.scanFile(fileToScan, false);
        const cleaned = sanitizeTrackingInput(decoded || '');
        if (cleaned.length >= 8) {
          return cleaned;
        }
      } catch {
        // Probar siguiente ángulo
      }
    }
  } catch {
    // Sin código de barras decodificable
  }

  return '';
}

/**
 * CAPA 2: Enrutador Multi-Modelo Gemini Vision Free-Tier + Few-Shot Dynamic Prompting
 */
async function extractLabelWithGeminiRouterLayer2(
  previewDataUrl: string
): Promise<{
  trackingNumber?: string;
  recipientName?: string;
  recipientPhone?: string;
  rawAddress?: string;
  neighborhood?: string;
  modelUsed?: string;
} | null> {
  const fewShotBlock = await buildFewShotPromptExamples();

  const prompt = `Eres un experto lector de etiquetas logísticas de iMile Colombia (paquetes de Shein y Temu en Medellín).
NOTA CRÍTICA: El texto del bloque "TO" puede venir rotado 90 grados (vertical) o en horizontal. Léelo en la orientación correcta.
PROHIBIDO devolver texto basura como símbolos "@, ©, =, [, ]" o palabras de plantilla como "Ref No, Ship Date, Declared value, Sleeve blouse, ANT 000-MEP".

Ejemplos reales aprendidos de mi ruta en Medellín (Few-Shot):
${fewShotBlock}

Extrae del bloque "TO" (destinatario) y del código de barras superior/inferior los siguientes campos en JSON estricto:
{
  "trackingNumber": "número de guía de 12 a 13 dígitos que suele empezar por 610 (ej: 6103026696672)",
  "recipientName": "nombre y apellidos limpios del cliente en el bloque TO (SOLO letras y espacios, ej: Alba Lucia Lopera Castrillon)",
  "recipientPhone": "celular colombiano de 10 o 12 dígitos que empieza por 573 o 3 (ej: 573225873762)",
  "rawAddress": "dirección física limpia en Medellín (ej: Carrera 43C # 100 - 52)",
  "neighborhood": "barrio o sector en Medellín si aparece"
}`;

  const routerRes = await invokeGeminiWithFreeTierRouter({
    prompt,
    inlineImageBase64: previewDataUrl,
    expectJson: true,
    timeoutMs: 1900,
  });

  if (!routerRes) return null;

  try {
    const cleanedJson = routerRes.text
      .replace(/^```json\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    const parsed = JSON.parse(cleanedJson);

    const validName = isValidCleanRecipientName(String(parsed.recipientName || ''));
    const validAddr =
      normalizeCleanMedellinAddressString(String(parsed.rawAddress || '')) ||
      sanitizeExtractedHumanText(String(parsed.rawAddress || ''), 'address');

    return {
      trackingNumber: sanitizeTrackingInput(String(parsed.trackingNumber || '')),
      recipientName: validName || '',
      recipientPhone: normalizeColombianPhone(String(parsed.recipientPhone || '')),
      rawAddress: validAddr || '',
      neighborhood: sanitizeExtractedHumanText(String(parsed.neighborhood || 'Medellín'), 'name'),
      modelUsed: routerRes.modelUsed,
    };
  } catch {
    return null;
  }
}

/**
 * Anclaje Espacial por Teléfono (`573\d{9}`) sobre texto OCR crudo de un ángulo dado:
 * En las etiquetas de iMile Colombia, el bloque "TO" tiene 3 líneas consecutivas:
 *   - Línea superior al celular: Nombre del destinatario (`alba lucia lopera castrillon`)
 *   - Línea central (Ancla): Teléfono `573\d{9}` seguido de `/` (`573225873762/`)
 *   - Línea inferior al celular: Dirección + Municipio (`carrera 43c #100 52 MEDELLIN ANTIOQUIA`)
 */
export function parseIMileOcrTextStrict(rawOcrText: string): {
  trackingNumber: string;
  recipientName: string;
  recipientPhone: string;
  rawAddress: string;
  neighborhood: string;
  qualityScore: number;
} {
  const fixedText = applyLearnedThermalOcrFixes(rawOcrText || '');
  const normalizedLines = fixedText
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  const fullJoined = normalizedLines.join('\n');

  // 1. Buscar número de guía iMile (12 a 15 dígitos, priorizando prefijo 610...)
  let trackingNumber = '';
  const compactDigitsMatches = fullJoined.replace(/[oO]/g, '0').match(/\b(610\d{9,11}|6\d{11,13}|\d{12,14})\b/g);
  if (compactDigitsMatches && compactDigitsMatches.length > 0) {
    const preferred610 = compactDigitsMatches.find((m) => m.startsWith('610'));
    trackingNumber = preferred610 || compactDigitsMatches[0];
  }

  // 2. Buscar Teléfono Ancla (`573\d{9}` o `3\d{9}`)
  let recipientPhone = '';
  let phoneLineIndex = -1;

  for (let i = 0; i < normalizedLines.length; i++) {
    const lineDigits = normalizedLines[i].replace(/[^\d]/g, '');
    const m573 = lineDigits.match(/(573\d{9})/);
    if (m573) {
      recipientPhone = m573[1];
      phoneLineIndex = i;
      break;
    }
    const m3 = lineDigits.match(/\b(3\d{9})\b/);
    if (m3 && lineDigits.length <= 12) {
      recipientPhone = `57${m3[1]}`;
      phoneLineIndex = i;
      break;
    }
  }

  if (!recipientPhone) {
    const globalPhoneMatch = fullJoined.match(
      /\b(57[\s\-]*3\d{2}[\s\-]*\d{3}[\s\-]*\d{4}|3\d{2}[\s\-]*\d{3}[\s\-]*\d{4})\b/
    );
    if (globalPhoneMatch) {
      recipientPhone = normalizeColombianPhone(globalPhoneMatch[1]);
    }
  }

  // 3. Extraer Nombre y Dirección usando el Teléfono como Ancla Espacial
  let recipientName = '';
  let rawAddress = '';

  if (phoneLineIndex >= 0) {
    // 3A. Revisar si en la misma línea del teléfono está el nombre antes del celular o la dirección después
    const anchorLine = normalizedLines[phoneLineIndex];
    const partsBySlash = anchorLine.split('/');
    if (partsBySlash.length >= 2) {
      const maybeAddrSameLine = normalizeCleanMedellinAddressString(partsBySlash.slice(1).join(' '));
      if (maybeAddrSameLine) rawAddress = maybeAddrSameLine;
    }

    // 3B. Buscar Nombre en las 1-3 líneas inmediatamente superiores al teléfono
    for (let up = phoneLineIndex - 1; up >= Math.max(0, phoneLineIndex - 3); up--) {
      const candidateName = isValidCleanRecipientName(normalizedLines[up]);
      if (candidateName) {
        recipientName = candidateName;
        break;
      }
    }

    // 3C. Buscar Dirección en las 1-3 líneas inmediatamente inferiores al teléfono
    if (!rawAddress) {
      const belowCombined = normalizedLines
        .slice(phoneLineIndex, Math.min(normalizedLines.length, phoneLineIndex + 4))
        .join(' ');
      const addrBelow = normalizeCleanMedellinAddressString(belowCombined);
      if (addrBelow) {
        rawAddress = addrBelow;
      }
    }
  }

  // 4. Si aún falta dirección o nombre, buscar en todo el bloque con el sanitizador estricto
  if (!rawAddress) {
    const globalAddr = normalizeCleanMedellinAddressString(fullJoined);
    if (globalAddr) rawAddress = globalAddr;
  }

  if (!recipientName) {
    const parsedBlock = parseIMileLabelBlock(fullJoined);
    if (parsedBlock.recipientName) {
      const validated = isValidCleanRecipientName(parsedBlock.recipientName);
      if (validated) recipientName = validated;
    }
  }

  let qualityScore = 0;
  if (trackingNumber.length >= 12) qualityScore += 2;
  if (recipientPhone.length >= 12) qualityScore += 3;
  if (rawAddress.length >= 8) qualityScore += 4;
  if (recipientName.length >= 5) qualityScore += 3;

  return {
    trackingNumber,
    recipientName,
    recipientPhone,
    rawAddress,
    neighborhood: 'Medellín',
    qualityScore,
  };
}

/**
 * CAPA 3: Motor OCR Multi-Ángulo (`0°`, `90° CW`, `270° CCW`) con Tesseract.js
 * Si en 0° no obtiene simultáneamente un nombre limpio y una dirección válida de Medellín,
 * rota automáticamente el canvas a 90° y 270° para leer etiquetas verticales de iMile.
 */
async function extractLabelWithMultiAngleOcrLayer3(
  angleImages: Array<{ deg: number; dataUrl: string }>,
  onProgress?: ScanStageCallback
): Promise<{
  trackingNumber: string;
  recipientName: string;
  recipientPhone: string;
  rawAddress: string;
  neighborhood: string;
  rawOcrText: string;
  rotationUsedDeg: number;
}> {
  const worker = await createWorker('spa');
  let bestResult = {
    trackingNumber: '',
    recipientName: '',
    recipientPhone: '',
    rawAddress: '',
    neighborhood: 'Medellín',
    rawOcrText: '',
    rotationUsedDeg: 0,
    qualityScore: -1,
  };

  try {
    for (let i = 0; i < angleImages.length; i++) {
      const { deg, dataUrl } = angleImages[i];
      onProgress?.(
        deg === 0
          ? '🔍 Analizando bloque "TO" (Orientación 0°)...'
          : `🔄 Etiqueta vertical detectada: Rotando ${deg}° y leyendo bloque "TO"...`,
        55 + i * 14
      );

      const ret = await worker.recognize(dataUrl);
      const rawText = ret?.data?.text || '';
      const parsed = parseIMileOcrTextStrict(rawText);

      // Combinar el mejor trackingNumber y recipientPhone hallados en cualquier orientación
      const mergedTracking = parsed.trackingNumber || bestResult.trackingNumber;
      const mergedPhone = parsed.recipientPhone || bestResult.recipientPhone;
      const mergedName = parsed.recipientName || bestResult.recipientName;
      const mergedAddress = parsed.rawAddress || bestResult.rawAddress;

      if (parsed.qualityScore > bestResult.qualityScore) {
        bestResult = {
          trackingNumber: mergedTracking,
          recipientName: mergedName,
          recipientPhone: mergedPhone,
          rawAddress: mergedAddress,
          neighborhood: parsed.neighborhood,
          rawOcrText: rawText,
          rotationUsedDeg: deg,
          qualityScore: parsed.qualityScore,
        };
      } else {
        bestResult.trackingNumber = mergedTracking;
        bestResult.recipientPhone = mergedPhone;
        bestResult.recipientName = mergedName;
        bestResult.rawAddress = mergedAddress;
      }

      // Si ya obtuvimos Nombre válido + Dirección válida + Teléfono, no necesitamos rotar más ángulos
      if (bestResult.recipientName && bestResult.rawAddress && bestResult.recipientPhone) {
        break;
      }
    }

    await worker.terminate();
    return bestResult;
  } catch {
    try {
      await worker.terminate();
    } catch {
      // Ignore
    }
    return bestResult;
  }
}

/**
 * PIPELINE PRINCIPAL v6.0: Escanea una etiqueta física de iMile combinando:
 * 1. Detección de Código de Barras Multi-Ángulo (0° y 90°) + Instant Recall (0ms en Memoria de Ruta)
 * 2. Router Multi-Modelo Gemini Free-Tier con Few-Shot Learning (si hay internet y cuota gratuita segura)
 * 3. Motor OCR Multi-Ángulo (0° / 90° / 270°) con Ancla de Teléfono (`573...`) y Sanitizador Estricto Anti-Basura
 */
export async function scanIMileLabelSmart(
  source: File | Blob | HTMLVideoElement | string,
  onStageUpdate?: ScanStageCallback
): Promise<SmartLabelScanResult> {
  const startTime = performance.now();

  onStageUpdate?.('📸 Optimizando imagen y orientaciones (0° / 90°)...', 12);
  const {
    previewDataUrl,
    ocrProcessedDataUrl,
    ocrRotated90DataUrl,
    ocrRotated270DataUrl,
    canvasElement,
    canvasRotated90,
  } = await prepareLabelImagesFromSource(source);

  // CAPA 1: Lector de Barras en 0° y 90°
  onStageUpdate?.('⚡ Leyendo código de barras 1D/QR...', 25);
  const barcodePromise = detectBarcodeLayer1(
    [canvasElement, canvasRotated90],
    [previewDataUrl, ocrRotated90DataUrl]
  );

  // CAPA 2: Enrutador Multi-Modelo Gemini Free-Tier (con Few-Shot) en paralelo
  onStageUpdate?.('🧠 Consultando Router IA Free-Tier + Memoria de Ruta...', 38);
  const aiVisionPromise = extractLabelWithGeminiRouterLayer2(previewDataUrl);

  const [barcodeDetected, aiResult] = await Promise.all([barcodePromise, aiVisionPromise]);

  let finalTracking = barcodeDetected || aiResult?.trackingNumber || '';
  let finalName = aiResult?.recipientName || '';
  let finalPhone = aiResult?.recipientPhone || '';
  let finalAddress = aiResult?.rawAddress || '';
  let finalNeighborhood = aiResult?.neighborhood || 'Medellín';
  let rawOcrText = '';
  let rotationUsedDeg = 0;
  let recalledFromMemory = false;
  let engineUsed: SmartLabelScanResult['engineUsed'] = aiResult?.rawAddress
    ? 'hybrid_ai_vision'
    : 'offline_tesseract_ocr';
  let engineBadge = aiResult?.modelUsed
    ? `✨ IA Vision (${aiResult.modelUsed} Free-Tier)`
    : '⚡ Motor Multi-Ángulo OCR + Ancla TO';

  // CAPA MEMORIA INSTANTÁNEA (Instant Recall en 0ms si ya tenemos guía o teléfono)
  if (finalTracking || finalPhone) {
    const memoryMatch = await recallFromLearnedMemory({
      trackingNumber: finalTracking,
      recipientPhone: finalPhone,
    });
    if (memoryMatch && memoryMatch.matched) {
      finalName = finalName || memoryMatch.recipientName;
      finalPhone = finalPhone || memoryMatch.recipientPhone;
      finalAddress = finalAddress || memoryMatch.rawAddress;
      finalNeighborhood = memoryMatch.neighborhood || finalNeighborhood;
      finalTracking = finalTracking || memoryMatch.trackingNumber || '';
      rotationUsedDeg = memoryMatch.preferredRotationDeg;
      recalledFromMemory = true;
      engineUsed = 'learned_memory_recall';
      engineBadge = memoryMatch.badgeText;
    }
  }

  // CAPA 3: Si aún falta Dirección o Nombre limpio, ejecutar Motor OCR Multi-Ángulo (0°, 90°, 270°)
  if (!finalAddress || !finalName || !finalPhone) {
    const ocrResult = await extractLabelWithMultiAngleOcrLayer3(
      [
        { deg: 0, dataUrl: ocrProcessedDataUrl },
        { deg: 90, dataUrl: ocrRotated90DataUrl },
        { deg: 270, dataUrl: ocrRotated270DataUrl },
      ],
      onStageUpdate
    );

    rawOcrText = ocrResult.rawOcrText;
    rotationUsedDeg = ocrResult.rotationUsedDeg;

    if (!finalTracking && ocrResult.trackingNumber) {
      finalTracking = ocrResult.trackingNumber;
    }
    if (!finalPhone && ocrResult.recipientPhone) {
      finalPhone = ocrResult.recipientPhone;
    }
    if (!finalName && ocrResult.recipientName) {
      finalName = ocrResult.recipientName;
    }
    if (!finalAddress && ocrResult.rawAddress) {
      finalAddress = ocrResult.rawAddress;
    }

    // Volver a consultar Memoria de Ruta con el teléfono o guía recién extraídos por OCR
    if ((!finalName || !finalAddress) && (finalTracking || finalPhone)) {
      const memoryAfterOcr = await recallFromLearnedMemory({
        trackingNumber: finalTracking,
        recipientPhone: finalPhone,
      });
      if (memoryAfterOcr && memoryAfterOcr.matched) {
        finalName = finalName || memoryAfterOcr.recipientName;
        finalPhone = finalPhone || memoryAfterOcr.recipientPhone;
        finalAddress = finalAddress || memoryAfterOcr.rawAddress;
        finalNeighborhood = memoryAfterOcr.neighborhood || finalNeighborhood;
        finalTracking = finalTracking || memoryAfterOcr.trackingNumber || '';
        recalledFromMemory = true;
        engineUsed = 'learned_memory_recall';
        engineBadge = memoryAfterOcr.badgeText;
      }
    }
  }

  // Validación final estricta Anti-Basura (jamás permitir basura en Nombre ni Dirección)
  finalTracking = sanitizeTrackingInput(finalTracking);
  finalPhone = normalizeColombianPhone(finalPhone);
  finalName = isValidCleanRecipientName(finalName) || '';
  finalAddress =
    normalizeCleanMedellinAddressString(finalAddress) ||
    sanitizeExtractedHumanText(finalAddress, 'address');

  let comunaName = '';
  let terrainWarning = '';
  if (finalAddress) {
    const medellinIntel = inferMedellinComunaAndNormalizeAddress(finalAddress);
    if (!finalNeighborhood || finalNeighborhood === 'Medellín') {
      finalNeighborhood = medellinIntel.inferredNeighborhood;
    }
    comunaName = medellinIntel.comunaName;
    terrainWarning = medellinIntel.terrainWarning;
  }

  let fieldsDetectedCount = 0;
  if (finalTracking) fieldsDetectedCount++;
  if (finalName) fieldsDetectedCount++;
  if (finalPhone) fieldsDetectedCount++;
  if (finalAddress) fieldsDetectedCount++;

  if (fieldsDetectedCount === 1 && finalTracking && !finalAddress && !finalName) {
    engineUsed = 'barcode_only';
    engineBadge = '⚡ Código de Barras Leído';
  } else if (rotationUsedDeg !== 0 && !recalledFromMemory) {
    engineBadge = `🔄 Auto-Rotación ${rotationUsedDeg}° + Ancla TO`;
  }

  const durationMs = Math.round(performance.now() - startTime);
  onStageUpdate?.('✨ ¡Lectura inteligente completada!', 100);

  return {
    trackingNumber: finalTracking,
    lastFourDigits: extractLastFourDigits(finalTracking),
    recipientName: finalName,
    recipientPhone: finalPhone,
    rawAddress: finalAddress,
    neighborhood: finalNeighborhood,
    comunaName,
    terrainWarning,
    engineUsed,
    engineBadge,
    durationMs,
    previewDataUrl,
    rawOcrText,
    fieldsDetectedCount,
    rotationUsedDeg,
    recalledFromMemory,
  };
}
