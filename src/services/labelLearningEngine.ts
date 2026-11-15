/**
 * Motor de Aprendizaje Continuo de Etiquetas iMile (`Adaptive Label Learning Engine`) — v6.0
 *
 * Aprende de cada etiqueta física de iMile (Shein/Temu) escaneada y confirmada en Medellín:
 * 1. Instant Recall (0ms): Autocompleta Nombre y Dirección verificada apenas detecta celular o guía.
 * 2. Retroalimentación OCR: Aprende correcciones de fuentes térmicas de iMile y rotación óptima (0°/90°/270°).
 * 3. Few-Shot Dynamic Prompting: Inyecta las últimas 5 etiquetas reales validadas en los prompts de Gemini Vision.
 */

import {
  db,
  normalizeColombianPhone,
  extractLastFourDigits,
  type LearnedPatternRecord,
} from '../db/database';
import { inferMedellinComunaAndNormalizeAddress } from './aiCopilotService';

const OCR_TYPO_DICTIONARY_KEY = 'miruta_learned_ocr_dictionary_v6';
const BASELINE_SEEDED_KEY = 'miruta_learned_baseline_v6_seeded';

export interface OcrTypoRule {
  wrongToken: string;
  correctedToken: string;
  hits: number;
}

const DEFAULT_IMILE_THERMAL_FIXES: Record<string, string> = {
  earrera: 'Carrera',
  cawera: 'Carrera',
  carrora: 'Carrera',
  carera: 'Carrera',
  cal1e: 'Calle',
  ca11e: 'Calle',
  medelln: 'Medellin',
  mede11in: 'Medellin',
  ant1oquia: 'Antioquia',
};

export function applyLearnedThermalOcrFixes(rawText: string): string {
  if (!rawText) return '';
  let output = rawText;

  for (const [wrong, right] of Object.entries(DEFAULT_IMILE_THERMAL_FIXES)) {
    const regex = new RegExp(`\\b${wrong}\\b`, 'gi');
    output = output.replace(regex, right);
  }

  if (typeof window !== 'undefined') {
    try {
      const savedRaw = localStorage.getItem(OCR_TYPO_DICTIONARY_KEY);
      if (savedRaw) {
        const customRules = JSON.parse(savedRaw) as Record<string, string>;
        for (const [wrong, right] of Object.entries(customRules)) {
          if (wrong.length >= 3 && right.length >= 2) {
            const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            output = output.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), right);
          }
        }
      }
    } catch {
      // Ignore storage parse error
    }
  }

  return output;
}

function recordCustomOcrCorrection(rawOcrAttempt: string, finalCleanAddress: string): void {
  if (typeof window === 'undefined' || !rawOcrAttempt || !finalCleanAddress) return;
  try {
    const savedRaw = localStorage.getItem(OCR_TYPO_DICTIONARY_KEY);
    const dict: Record<string, string> = savedRaw ? JSON.parse(savedRaw) : {};

    // Si el OCR confundió Carrera/Calle al inicio
    if (/^carrera\b/i.test(finalCleanAddress) && /\b(c[a-z]{4,6}ra)\b/i.test(rawOcrAttempt)) {
      const match = rawOcrAttempt.match(/\b(c[a-z]{4,6}ra)\b/i);
      if (match && match[1].toLowerCase() !== 'carrera') {
        dict[match[1].toLowerCase()] = 'Carrera';
      }
    }
    localStorage.setItem(OCR_TYPO_DICTIONARY_KEY, JSON.stringify(dict));
  } catch {
    // Ignore
  }
}

/**
 * Inicializa la base de conocimiento con el patrón real verificado de etiqueta iMile #6672
 * y los destinatarios reales ya entregados en `db.packages`.
 */
export async function ensureBaselineLearnedPatterns(): Promise<void> {
  try {
    const existingCount = await db.learnedPatterns.count();
    const alreadySeeded =
      typeof window !== 'undefined' && localStorage.getItem(BASELINE_SEEDED_KEY) === 'true';

    if (existingCount > 0 && alreadySeeded) return;

    // 1. Sembrar el caso real verificado de etiqueta física iMile #6672 (orientación vertical 90°)
    const refPhone = '573225873762';
    const existingRef = await db.learnedPatterns
      .where('recipientPhone')
      .equals(refPhone)
      .first();

    if (!existingRef) {
      await db.learnedPatterns.put({
        recipientPhone: refPhone,
        recipientName: 'Alba Lucia Lopera Castrillon',
        normalizedAddress: 'Carrera 43C # 100 - 52',
        neighborhood: 'Santa Cruz / Popular (Comuna 1-2)',
        sampleTrackingNumber: '6103026696672',
        lastFourDigits: '6672',
        ocrRawSnippet:
          'TO: alba lucia lopera castrillon 573225873762/ carrera 43c #100 52 MEDELLIN ANTIOQUIA',
        preferredRotationDeg: 90,
        toBlockRelativeBox: { x: 0.08, y: 0.42, w: 0.84, h: 0.34 },
        confirmationsCount: 5,
        updatedAt: Date.now(),
      });
    }

    // 2. Aprender también de los paquetes ya existentes en `db.packages`
    const packages = await db.packages.toArray();
    for (const pkg of packages) {
      const cleanPhone = normalizeColombianPhone(pkg.recipientPhone);
      if (
        cleanPhone.length >= 10 &&
        pkg.recipientName &&
        pkg.recipientName !== 'Cliente iMile' &&
        pkg.rawAddress
      ) {
        const exists = await db.learnedPatterns
          .where('recipientPhone')
          .equals(cleanPhone)
          .first();
        if (!exists) {
          await db.learnedPatterns.put({
            recipientPhone: cleanPhone,
            recipientName: pkg.recipientName,
            normalizedAddress: pkg.rawAddress,
            neighborhood: pkg.parsedAddress?.neighborhood || 'Medellín',
            sampleTrackingNumber: pkg.trackingNumber,
            lastFourDigits: pkg.lastFourDigits || extractLastFourDigits(pkg.trackingNumber),
            preferredRotationDeg: 90,
            confirmationsCount: 1,
            updatedAt: pkg.deliveredAt || pkg.scannedAt || Date.now(),
          });
        }
      }
    }

    if (typeof window !== 'undefined') {
      localStorage.setItem(BASELINE_SEEDED_KEY, 'true');
    }
  } catch {
    // Non-blocking initialization
  }
}

export interface InstantRecallMatch {
  matched: boolean;
  recipientName: string;
  recipientPhone: string;
  rawAddress: string;
  neighborhood: string;
  trackingNumber?: string;
  preferredRotationDeg: number;
  badgeText: string;
}

/**
 * Memoria Instantánea (`Instant Recall` en 0ms):
 * Busca por teléfono (`573...`), número de guía (`6103026696672`) o últimos 4 dígitos
 * en `db.learnedPatterns` y en el historial de `db.packages`.
 */
export async function recallFromLearnedMemory(query: {
  trackingNumber?: string;
  recipientPhone?: string;
  rawAddressFragment?: string;
}): Promise<InstantRecallMatch | null> {
  await ensureBaselineLearnedPatterns();

  const cleanPhone = query.recipientPhone
    ? normalizeColombianPhone(query.recipientPhone)
    : '';
  const cleanTracking = (query.trackingNumber || '').replace(/\D/g, '');

  // 1. Búsqueda por Número de Guía exacto (12-15 dígitos) en learnedPatterns
  if (cleanTracking.length >= 10) {
    const byTracking = await db.learnedPatterns
      .where('sampleTrackingNumber')
      .equals(cleanTracking)
      .first();
    if (byTracking) {
      return {
        matched: true,
        recipientName: byTracking.recipientName,
        recipientPhone: byTracking.recipientPhone,
        rawAddress: byTracking.normalizedAddress,
        neighborhood: byTracking.neighborhood,
        trackingNumber: byTracking.sampleTrackingNumber,
        preferredRotationDeg: byTracking.preferredRotationDeg ?? 90,
        badgeText: '🧠 Reconocido por Memoria de Ruta (Guía/Cliente aprendido)',
      };
    }
  }

  // 2. Búsqueda por Teléfono exacto (`573...`) en learnedPatterns
  if (cleanPhone.length >= 10) {
    const byPhone = await db.learnedPatterns
      .where('recipientPhone')
      .equals(cleanPhone)
      .first();
    if (byPhone) {
      return {
        matched: true,
        recipientName: byPhone.recipientName,
        recipientPhone: byPhone.recipientPhone,
        rawAddress: byPhone.normalizedAddress,
        neighborhood: byPhone.neighborhood,
        trackingNumber: cleanTracking || byPhone.sampleTrackingNumber,
        preferredRotationDeg: byPhone.preferredRotationDeg ?? 90,
        badgeText: '🧠 Reconocido por Memoria de Ruta (Cliente/Dirección aprendida)',
      };
    }

    // Búsqueda por últimos 10 dígitos del celular
    const last10 = cleanPhone.slice(-10);
    const allLearned = await db.learnedPatterns.toArray();
    const matchedLast10 = allLearned.find((lp) => lp.recipientPhone.endsWith(last10));
    if (matchedLast10) {
      return {
        matched: true,
        recipientName: matchedLast10.recipientName,
        recipientPhone: matchedLast10.recipientPhone,
        rawAddress: matchedLast10.normalizedAddress,
        neighborhood: matchedLast10.neighborhood,
        trackingNumber: cleanTracking || matchedLast10.sampleTrackingNumber,
        preferredRotationDeg: matchedLast10.preferredRotationDeg ?? 90,
        badgeText: '🧠 Reconocido por Memoria de Ruta (Cliente recurrente del sector)',
      };
    }
  }

  // 3. Búsqueda en el historial general de `db.packages`
  if (cleanTracking.length >= 10 || cleanPhone.length >= 10) {
    const allPkgs = await db.packages.toArray();
    const foundPkg = allPkgs.find(
      (p) =>
        (cleanTracking.length >= 10 && p.trackingNumber === cleanTracking) ||
        (cleanPhone.length >= 10 &&
          normalizeColombianPhone(p.recipientPhone) === cleanPhone)
    );
    if (foundPkg && foundPkg.recipientName && foundPkg.rawAddress) {
      return {
        matched: true,
        recipientName: foundPkg.recipientName,
        recipientPhone: normalizeColombianPhone(foundPkg.recipientPhone),
        rawAddress: foundPkg.rawAddress,
        neighborhood: foundPkg.parsedAddress?.neighborhood || 'Medellín',
        trackingNumber: cleanTracking || foundPkg.trackingNumber,
        preferredRotationDeg: 90,
        badgeText: '🧠 Reconocido por Historial de Entregas en tu Ruta',
      };
    }
  }

  return null;
}

/**
 * Aprende cada vez que el repartidor guarda o confirma un paquete en `ScannerModal.tsx`.
 */
export async function learnFromConfirmedPackage(input: {
  trackingNumber: string;
  recipientName: string;
  recipientPhone: string;
  rawAddress: string;
  rawOcrAttempt?: string;
  rotationUsedDeg?: number;
}): Promise<LearnedPatternRecord | null> {
  const cleanPhone = normalizeColombianPhone(input.recipientPhone);
  const cleanTracking = (input.trackingNumber || '').replace(/\D/g, '');
  const cleanName = (input.recipientName || '').trim();
  const cleanAddress = (input.rawAddress || '').trim();

  if (!cleanAddress || cleanName.length < 3) return null;

  if (input.rawOcrAttempt) {
    recordCustomOcrCorrection(input.rawOcrAttempt, cleanAddress);
  }

  const intel = inferMedellinComunaAndNormalizeAddress(cleanAddress);
  const phoneKey = cleanPhone.length >= 10 ? cleanPhone : `guide_${cleanTracking || Date.now()}`;

  const existing = await db.learnedPatterns
    .where('recipientPhone')
    .equals(phoneKey)
    .first();

  const record: LearnedPatternRecord = {
    ...(existing?.id ? { id: existing.id } : {}),
    recipientPhone: phoneKey,
    recipientName: cleanName,
    normalizedAddress: cleanAddress,
    neighborhood: intel.inferredNeighborhood || 'Medellín',
    sampleTrackingNumber: cleanTracking || existing?.sampleTrackingNumber || '',
    lastFourDigits: extractLastFourDigits(cleanTracking || existing?.sampleTrackingNumber || ''),
    ocrRawSnippet: input.rawOcrAttempt || existing?.ocrRawSnippet || '',
    preferredRotationDeg: input.rotationUsedDeg ?? existing?.preferredRotationDeg ?? 90,
    toBlockRelativeBox: existing?.toBlockRelativeBox || {
      x: 0.08,
      y: 0.42,
      w: 0.84,
      h: 0.34,
    },
    confirmationsCount: (existing?.confirmationsCount || 0) + 1,
    updatedAt: Date.now(),
  };

  await db.learnedPatterns.put(record);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('miruta-learning-updated'));
  }
  return record;
}

/**
 * Construye dinámicamente los 5 ejemplos reales aprendidos (*Few-Shot Prompting*)
 * para inyectarlos en el prompt de Gemini Vision.
 */
export async function buildFewShotPromptExamples(): Promise<string> {
  await ensureBaselineLearnedPatterns();
  const topLearned = await db.learnedPatterns
    .orderBy('updatedAt')
    .reverse()
    .limit(5)
    .toArray();

  if (topLearned.length === 0) {
    return `Ejemplo real verificado #1:
- trackingNumber: "6103026696672"
- recipientName: "Alba Lucia Lopera Castrillon"
- recipientPhone: "573225873762"
- rawAddress: "Carrera 43C # 100 - 52"`;
  }

  return topLearned
    .map(
      (lp, idx) =>
        `Ejemplo real verificado #${idx + 1}:
- trackingNumber: "${lp.sampleTrackingNumber || '6103026696672'}"
- recipientName: "${lp.recipientName}"
- recipientPhone: "${lp.recipientPhone}"
- rawAddress: "${lp.normalizedAddress}"`
    )
    .join('\n');
}

export interface LearningEngineStats {
  learnedPatternsCount: number;
  totalConfirmations: number;
  preferredRotationDeg: number;
  badgeLabel: string;
}

export async function getLearningEngineStats(): Promise<LearningEngineStats> {
  await ensureBaselineLearnedPatterns();
  const all = await db.learnedPatterns.toArray();
  const learnedPatternsCount = all.length;
  const totalConfirmations = all.reduce((acc, r) => acc + (r.confirmationsCount || 1), 0);

  return {
    learnedPatternsCount,
    totalConfirmations,
    preferredRotationDeg: 90,
    badgeLabel: `🧠 IA Entrenada con ${learnedPatternsCount} etiquetas iMile (${totalConfirmations} lecturas verificadas)`,
  };
}
