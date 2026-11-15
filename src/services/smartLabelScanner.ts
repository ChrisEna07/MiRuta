import { createWorker } from 'tesseract.js';
import { Html5Qrcode } from 'html5-qrcode';
import { extractLastFourDigits } from '../db/database';
import { parseIMileLabelBlock } from '../utils/addressParser';
import { sanitizeTrackingInput } from '../utils/formatters';

const GEMINI_API_KEY_STORAGE = 'miruta_gemini_api_key';

export interface SmartVisionConfig {
  geminiApiKey: string;
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
  engineUsed: 'hybrid_ai_vision' | 'offline_tesseract_ocr' | 'barcode_only';
  engineBadge: string;
  durationMs: number;
  previewDataUrl: string;
  rawOcrText?: string;
  fieldsDetectedCount: number;
}

export type ScanStageCallback = (stageMessage: string, progressPercent?: number) => void;

export function getSmartVisionConfig(): SmartVisionConfig {
  const envMap = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
  const envKey = envMap.VITE_GEMINI_API_KEY || '';
  const storedKey =
    typeof window !== 'undefined' ? localStorage.getItem(GEMINI_API_KEY_STORAGE) || '' : '';
  const finalKey = (storedKey || envKey).trim();
  const hasAiVisionKey = finalKey.length > 15;

  return {
    geminiApiKey: finalKey,
    hasAiVisionKey,
    modeLabel: hasAiVisionKey
      ? '🟢 Modo IA Vision Activo (Gemini Flash + Fallback OCR Offline)'
      : '⚡ Modo OCR Local + Barcode Nativo Activo (100% Gratis y Offline)'
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
 * Convierte cualquier fuente de imagen (File, Blob, HTMLVideoElement, DataURL)
 * en dos versiones optimizadas en <canvas>:
 * 1. `previewDataUrl`: JPEG en color nítido (máx 1150px) para vista previa, BarcodeDetector y Gemini Vision.
 * 2. `ocrProcessedDataUrl`: Imagen en escala de grises con alto contraste adaptativo para Tesseract OCR.
 */
export async function prepareLabelImagesFromSource(
  source: File | Blob | HTMLVideoElement | string
): Promise<{
  previewDataUrl: string;
  ocrProcessedDataUrl: string;
  canvasElement: HTMLCanvasElement;
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
    const img = await loadImageFromSource(source as File | Blob | string);
    width = img.naturalWidth || img.width || 1000;
    height = img.naturalHeight || img.height || 1000;
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

  const previewDataUrl = canvas.toDataURL('image/jpeg', 0.85);

  // Crear segundo canvas con realce de contraste y escala de grises para OCR Offline
  const ocrCanvas = document.createElement('canvas');
  ocrCanvas.width = width;
  ocrCanvas.height = height;
  const ocrCtx = ocrCanvas.getContext('2d');
  if (ocrCtx) {
    ocrCtx.drawImage(canvas, 0, 0);
    const imgData = ocrCtx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // Estiramiento de contraste suave (hace que las letras negras sobre plástico blanco/gris resalten)
    const contrast = 1.48;
    const intercept = 128 * (1 - contrast);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Luminancia perceptual
      let lum = 0.299 * r + 0.587 * g + 0.114 * b;
      lum = lum * contrast + intercept;
      const clamped = lum < 25 ? 0 : lum > 235 ? 255 : Math.round(lum);
      data[i] = clamped;
      data[i + 1] = clamped;
      data[i + 2] = clamped;
    }
    ocrCtx.putImageData(imgData, 0, 0);
  }

  const ocrProcessedDataUrl = ocrCanvas.toDataURL('image/jpeg', 0.9);
  return {
    previewDataUrl,
    ocrProcessedDataUrl,
    canvasElement: canvas
  };
}

function loadImageFromSource(source: File | Blob | string): Promise<HTMLImageElement> {
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

/**
 * CAPA 1: Detección por Hardware Nativo (`window.BarcodeDetector`) + Fallback `html5-qrcode`.
 */
export async function detectBarcodeFromCanvas(
  canvas: HTMLCanvasElement,
  previewDataUrl: string
): Promise<string> {
  // 1A. Intentar con la API nativa de hardware de Chrome Android (`BarcodeDetector`)
  try {
    const BarcodeDetectorClass = (
      window as unknown as {
        BarcodeDetector?: new (opts?: { formats: string[] }) => {
          detect: (img: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
        };
      }
    ).BarcodeDetector;

    if (BarcodeDetectorClass) {
      const detector = new BarcodeDetectorClass({
        formats: ['code_128', 'code_39', 'ean_13', 'qr_code', 'itf', 'codabar', 'data_matrix']
      });
      const results = await detector.detect(canvas);
      if (results && results.length > 0) {
        // Priorizar códigos de 12-15 dígitos tipo iMile (610...)
        const imileMatch = results.find((r) => /^61\d{10,12}$/.test((r.rawValue || '').trim()));
        if (imileMatch?.rawValue) {
          return sanitizeTrackingInput(imileMatch.rawValue);
        }
        const firstValid = results.find((r) => (r.rawValue || '').trim().length >= 4);
        if (firstValid?.rawValue) {
          return sanitizeTrackingInput(firstValid.rawValue);
        }
      }
    }
  } catch {
    // Continuar con fallback html5-qrcode
  }

  // 1B. Fallback con Html5Qrcode sobre archivo temporal
  try {
    const res = await fetch(previewDataUrl);
    const blob = await res.blob();
    const file = new File([blob], 'label-scan.jpg', { type: 'image/jpeg' });

    const tempId = 'miruta-hidden-file-barcode-scanner';
    let tempEl = document.getElementById(tempId);
    if (!tempEl) {
      tempEl = document.createElement('div');
      tempEl.id = tempId;
      tempEl.style.display = 'none';
      document.body.appendChild(tempEl);
    }

    const html5Qr = new Html5Qrcode(tempId);
    const decoded = await html5Qr.scanFile(file, false);
    html5Qr.clear();
    if (decoded) {
      return sanitizeTrackingInput(decoded);
    }
  } catch {
    // Si no se detecta código de barras por imagen, las capas 2 y 3 lo extraerán por texto
  }

  return '';
}

/**
 * CAPA 2: Visión Inteligente con IA (Gemini 2.5 Flash Vision API).
 */
async function analyzeLabelWithGeminiVision(
  previewDataUrl: string,
  apiKey: string
): Promise<Partial<SmartLabelScanResult> | null> {
  if (!apiKey || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return null;
  }

  const base64Data = previewDataUrl.replace(/^data:image\/\w+;base64,/, '');
  const prompt =
    'Analiza esta etiqueta logística de iMile Colombia (Shein/Temu). Extrae exactamente en JSON: { trackingNumber: string (guía de 12-15 dígitos ej. 6103026696672 o los 4 dígitos grandes si está cortada), recipientName: string (nombre debajo de TO), recipientPhone: string (celular colombiano ej. 573225873762), rawAddress: string (dirección física ej. Carrera 43c #100 52), neighborhood: string (barrio o municipio ej. Medellín) }.';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
        apiKey
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Data
                  }
                }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1
          }
        })
      }
    );

    clearTimeout(timeoutId);
    if (!response.ok) return null;

    const json = await response.json();
    const rawContent = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawContent) return null;

    const parsed = JSON.parse(rawContent);
    return {
      trackingNumber: sanitizeTrackingInput(String(parsed.trackingNumber || '')),
      recipientName: String(parsed.recipientName || '').trim(),
      recipientPhone: String(parsed.recipientPhone || '').replace(/\D/g, ''),
      rawAddress: String(parsed.rawAddress || '').trim(),
      neighborhood: String(parsed.neighborhood || 'Medellín').trim() || 'Medellín'
    };
  } catch {
    return null;
  }
}

/**
 * CAPA 3: Extractor heurístico especializado en etiquetas iMile Colombia (Shein/Temu)
 * a partir del texto crudo de OCR (`Tesseract.js`).
 */
export function extractIMileFieldsFromOCRText(rawOcrText: string): {
  trackingNumber: string;
  recipientName: string;
  recipientPhone: string;
  rawAddress: string;
  neighborhood: string;
} {
  const normalizedText = (rawOcrText || '')
    .replace(/\r/g, '\n')
    .replace(/[|¦]/g, ' ')
    .trim();

  const lines = normalizedText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // 1. Guía iMile (`trackingNumber`):
  // Prioridad A: Guía iMile Colombia que empieza por 61 (12 a 15 dígitos, ej. 6103026696672)
  let trackingNumber = '';
  const compactDigitsText = normalizedText.replace(/(\d)\s+(?=\d)/g, '$1');
  const imileTrackMatch =
    compactDigitsText.match(/\b(61\d{10,13})\b/) ||
    normalizedText.match(/\b(61\d{10,13})\b/) ||
    compactDigitsText.match(/\b(\d{12,15})\b/);

  if (imileTrackMatch) {
    trackingNumber = imileTrackMatch[1];
  } else {
    // Prioridad B: Número grande de 4 dígitos de clasificación en esquina derecha
    const fourDigitMatch = normalizedText.match(/(?:^|\s|#)(\d{4})(?:\s|$)/);
    if (fourDigitMatch) {
      trackingNumber = fourDigitMatch[1];
    }
  }

  // 2. Teléfono Celular Colombiano (`recipientPhone`):
  // Captura `573225873762` o `3225873762` aunque tenga `/` pegado al final (`573225873762/`)
  let recipientPhone = '';
  let phoneLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const cleanDigitsLine = lines[i].replace(/[^\d]/g, ' ');
    const match57 = lines[i].match(/(?:57)?\s*(3\d{2}[\s.-]*\d{3}[\s.-]*\d{4})/);
    const matchCompact = cleanDigitsLine.match(/\b(?:57)?(3\d{9})\b/);
    if (match57 || matchCompact) {
      const digitsOnly = (match57 ? match57[1] : matchCompact![1]).replace(/\D/g, '');
      recipientPhone = `57${digitsOnly.slice(-10)}`;
      phoneLineIndex = i;
      break;
    }
  }

  if (!recipientPhone) {
    const globalPhoneMatch = compactDigitsText.match(/(?:57)?(3\d{9})/);
    if (globalPhoneMatch) {
      recipientPhone = `57${globalPhoneMatch[1]}`;
    }
  }

  // 3. Dirección Física (`rawAddress`):
  // Busca líneas con nomenclatura vial colombiana (Carrera, Calle, CR, CL, Diag, Transv, Circular, Av)
  let rawAddress = '';
  const roadRegex =
    /\b(carrera|calle|cr|cl|cra|cll|diagonal|transversal|dg|tv|av|avenida|circular|manzana|mz|kilometro|km)\s*[0-9a-z#\-\s.,/]+/i;

  for (const line of lines) {
    const m = line.match(roadRegex);
    if (m) {
      rawAddress = m[0]
        .replace(/\b(MEDELL[IÍ]N|ANTIOQUIA|COLOMBIA|ENVIGADO|ITAG[UÜ][IÍ]|BELLO|SABANETA)\b/gi, '')
        .replace(/[/\\]+$/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (rawAddress.length >= 6) break;
    }
  }

  // Fallback si el OCR leyó "carrera 43c #100 52" partido o en el parser de bloque TO
  const blockFallback = parseIMileLabelBlock(normalizedText);
  if (!rawAddress && blockFallback.rawAddress) {
    rawAddress = blockFallback.rawAddress;
  }

  // 4. Nombre del Cliente (`recipientName`):
  // Extrae la línea alfabética inmediatamente antes del teléfono `573...` o después de `TO`
  let recipientName = '';
  const noiseWordsRegex =
    /\b(IMILE|EXPRESS|DELIVERY|STANDARD|HOME|COLOMBIA|ANTIOQUIA|MEDELLIN|TRACKING|NUMBER|WEIGHT|ORDER|SHEIN|TEMU|COD|COP)\b/i;

  if (phoneLineIndex >= 0) {
    // Revisar si en la misma línea del teléfono está el nombre antes del número (ej. "alba lucia lopera / 573225873762")
    const sameLineBeforePhone = lines[phoneLineIndex]
      .replace(/(?:57)?\s*3\d{2}[\s.-]*\d{3}[\s.-]*\d{4}.*$/, '')
      .replace(/\bTO\b[:\s]*/i, '')
      .replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (sameLineBeforePhone.length >= 4 && !noiseWordsRegex.test(sameLineBeforePhone)) {
      recipientName = toTitleCaseName(sameLineBeforePhone);
    } else if (phoneLineIndex > 0) {
      // Buscar en las 1 o 2 líneas inmediatamente anteriores al teléfono
      for (let back = 1; back <= 2; back++) {
        const candidateIdx = phoneLineIndex - back;
        if (candidateIdx < 0) break;
        const candidate = lines[candidateIdx]
          .replace(/^\bTO\b[:\s-]*/i, '')
          .replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim();
        if (
          candidate.length >= 4 &&
          !/\d{3,}/.test(lines[candidateIdx]) &&
          !noiseWordsRegex.test(candidate)
        ) {
          recipientName = toTitleCaseName(candidate);
          break;
        }
      }
    }
  }

  if (!recipientName) {
    // Buscar línea después de "TO"
    const toIndex = lines.findIndex((l) => /^TO\b/i.test(l) || /\bTO:\s*/i.test(l));
    if (toIndex !== -1) {
      const inlineAfterTo = lines[toIndex]
        .replace(/^.*?\bTO\b[:\s-]*/i, '')
        .replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, ' ')
        .trim();
      if (inlineAfterTo.length >= 4) {
        recipientName = toTitleCaseName(inlineAfterTo);
      } else if (lines[toIndex + 1]) {
        const nextLine = lines[toIndex + 1]
          .replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim();
        if (nextLine.length >= 4) {
          recipientName = toTitleCaseName(nextLine);
        }
      }
    }
  }

  if (!recipientName && blockFallback.recipientName) {
    recipientName = toTitleCaseName(blockFallback.recipientName);
  }

  // 5. Municipio / Barrio (`neighborhood`)
  let neighborhood = 'Medellín';
  if (/\bBELLO\b/i.test(normalizedText)) neighborhood = 'Bello';
  else if (/\bENVIGADO\b/i.test(normalizedText)) neighborhood = 'Envigado';
  else if (/\bITAG[UÜ][IÍ]\b/i.test(normalizedText)) neighborhood = 'Itagüí';
  else if (/\bSABANETA\b/i.test(normalizedText)) neighborhood = 'Sabaneta';
  else if (/\bPOBLADO\b/i.test(normalizedText)) neighborhood = 'El Poblado, Medellín';
  else if (/\bLAURELES\b/i.test(normalizedText)) neighborhood = 'Laureles, Medellín';
  else if (/\bBEL[EÉ]N\b/i.test(normalizedText)) neighborhood = 'Belén, Medellín';

  return {
    trackingNumber: sanitizeTrackingInput(trackingNumber || blockFallback.trackingNumber || ''),
    recipientName,
    recipientPhone,
    rawAddress,
    neighborhood
  };
}

function toTitleCaseName(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Ejecuta OCR 100% Offline usando `tesseract.js` sobre la imagen pre-procesada.
 */
async function runOfflineTesseractOCR(
  ocrProcessedDataUrl: string,
  onStage?: ScanStageCallback
): Promise<string> {
  onStage?.('🧠 Ejecutando OCR Offline en etiqueta iMile...', 55);
  const worker = await createWorker('eng');
  try {
    const ret = await worker.recognize(ocrProcessedDataUrl);
    return ret?.data?.text || '';
  } finally {
    await worker.terminate();
  }
}

/**
 * FUNCIÓN PRINCIPAL DE ESCANEO INTELIGENTE EN CASCADA (Capas 1 + 2 + 3).
 */
export async function scanIMileLabelSmart(
  source: File | Blob | HTMLVideoElement | string,
  onStage?: ScanStageCallback
): Promise<SmartLabelScanResult> {
  const startTime = performance.now();

  onStage?.('🔍 Pre-procesando etiqueta y enfocando contraste...', 15);
  const { previewDataUrl, ocrProcessedDataUrl, canvasElement } =
    await prepareLabelImagesFromSource(source);

  onStage?.('🔍 Leyendo código de barras y bloque "TO"...', 30);
  const hardwareBarcode = await detectBarcodeFromCanvas(canvasElement, previewDataUrl);

  const visionConfig = getSmartVisionConfig();
  let trackingNumber = hardwareBarcode;
  let recipientName = '';
  let recipientPhone = '';
  let rawAddress = '';
  let neighborhood = 'Medellín';
  let engineUsed: SmartLabelScanResult['engineUsed'] = 'offline_tesseract_ocr';
  let engineBadge = '⚡ Autocompletado por OCR Offline + Barcode';
  let rawOcrText = '';

  // CAPA 2: Si hay internet y API Key de Gemini Flash Vision configurada
  if (visionConfig.hasAiVisionKey && (typeof navigator === 'undefined' || navigator.onLine)) {
    onStage?.('🧠 Interpretando Nombre, Celular y Dirección con IA Vision...', 50);
    const aiResult = await analyzeLabelWithGeminiVision(
      previewDataUrl,
      visionConfig.geminiApiKey
    );
    if (aiResult && (aiResult.rawAddress || aiResult.recipientName || aiResult.trackingNumber)) {
      trackingNumber =
        hardwareBarcode && hardwareBarcode.length >= 10
          ? hardwareBarcode
          : aiResult.trackingNumber || hardwareBarcode;
      recipientName = aiResult.recipientName || '';
      recipientPhone = aiResult.recipientPhone || '';
      rawAddress = aiResult.rawAddress || '';
      neighborhood = aiResult.neighborhood || 'Medellín';
      engineUsed = 'hybrid_ai_vision';
      engineBadge = '✨ Autocompletado por Cámara IA Vision (Gemini Flash)';
    }
  }

  // CAPA 3: Motor OCR 100% Offline (`Tesseract.js` + Heurística iMile) si no se usó IA o faltan datos del bloque TO
  if (!rawAddress || !recipientPhone || !recipientName || !trackingNumber) {
    onStage?.('🧠 Interpretando Nombre, Celular y Dirección (Motor OCR Local)...', 65);
    try {
      rawOcrText = await runOfflineTesseractOCR(ocrProcessedDataUrl, onStage);
      const ocrFields = extractIMileFieldsFromOCRText(rawOcrText);

      if (!trackingNumber || (trackingNumber.length < 10 && ocrFields.trackingNumber.length >= 10)) {
        trackingNumber = ocrFields.trackingNumber || trackingNumber;
      }
      if (!recipientName && ocrFields.recipientName) {
        recipientName = ocrFields.recipientName;
      }
      if (!recipientPhone && ocrFields.recipientPhone) {
        recipientPhone = ocrFields.recipientPhone;
      }
      if (!rawAddress && ocrFields.rawAddress) {
        rawAddress = ocrFields.rawAddress;
      }
      if (neighborhood === 'Medellín' && ocrFields.neighborhood) {
        neighborhood = ocrFields.neighborhood;
      }
    } catch {
      // Si el OCR falla, mantenemos lo que haya capturado la Capa 1/2
    }
  }

  const finalTracking = sanitizeTrackingInput(trackingNumber);
  const lastFourDigits = extractLastFourDigits(finalTracking || '0000');

  let fieldsDetectedCount = 0;
  if (finalTracking) fieldsDetectedCount++;
  if (recipientName) fieldsDetectedCount++;
  if (recipientPhone) fieldsDetectedCount++;
  if (rawAddress) fieldsDetectedCount++;

  if (fieldsDetectedCount === 1 && finalTracking && !rawAddress && !recipientName) {
    engineUsed = 'barcode_only';
    engineBadge = '📷 Código de barras detectado';
  }

  const durationMs = Math.round(performance.now() - startTime);
  onStage?.('✅ ¡Etiqueta interpretada!', 100);

  return {
    trackingNumber: finalTracking,
    lastFourDigits,
    recipientName,
    recipientPhone,
    rawAddress,
    neighborhood,
    engineUsed,
    engineBadge,
    durationMs,
    previewDataUrl,
    rawOcrText,
    fieldsDetectedCount
  };
}
