/**
 * Enrutador Multi-Modelo Gemini con "Escudo Costo $0" (Free-Tier Quota Guardrail) — v6.0
 *
 * Garantiza disponibilidad continua usando únicamente cuotas gratuitas (Free Tier)
 * con un colchón de seguridad estricto del 20% antes del límite oficial para jamás generar cargos.
 */

export type GeminiFreeModelId =
  | 'gemini-2.5-flash'
  | 'gemini-2.5-flash-lite'
  | 'gemini-2.0-flash'
  | 'gemini-2.0-flash-lite'
  | 'gemini-1.5-flash';

export type ModelSelectionPreference = 'auto' | GeminiFreeModelId;

export interface FreeModelSpec {
  id: GeminiFreeModelId;
  displayName: string;
  tierRole: string;
  officialMaxRPM: number;
  safeMaxRPM: number;   // 20% safety buffer below official Free Tier
  officialMaxRPD: number;
  safeMaxRPD: number;   // 20% safety buffer below official Free Tier
}

export const FREE_TIER_MODEL_POOL: FreeModelSpec[] = [
  {
    id: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash (Primario)',
    tierRole: 'Primary Vision & Reasoning',
    officialMaxRPM: 15,
    safeMaxRPM: 10,
    officialMaxRPD: 250,
    safeMaxRPD: 200,
  },
  {
    id: 'gemini-2.5-flash-lite',
    displayName: 'Gemini 2.5 Flash-Lite (Alta Velocidad)',
    tierRole: 'Secondary High-Speed',
    officialMaxRPM: 15,
    safeMaxRPM: 12,
    officialMaxRPD: 500,
    safeMaxRPD: 400,
  },
  {
    id: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash (Respaldo Estable)',
    tierRole: 'Tertiary Stable',
    officialMaxRPM: 15,
    safeMaxRPM: 10,
    officialMaxRPD: 250,
    safeMaxRPD: 200,
  },
  {
    id: 'gemini-2.0-flash-lite',
    displayName: 'Gemini 2.0 Flash-Lite (Respaldo Ligero)',
    tierRole: 'Quaternary Light',
    officialMaxRPM: 15,
    safeMaxRPM: 12,
    officialMaxRPD: 500,
    safeMaxRPD: 400,
  },
  {
    id: 'gemini-1.5-flash',
    displayName: 'Gemini 1.5 Flash (Respaldo Clásico)',
    tierRole: 'Quinary Fallback',
    officialMaxRPM: 15,
    safeMaxRPM: 12,
    officialMaxRPD: 500,
    safeMaxRPD: 400,
  },
];

const QUOTA_STORAGE_KEY = 'miruta_gemini_free_quota_guardrail_v6';
const MODEL_PREF_STORAGE_KEY = 'miruta_gemini_model_pref_v6';
const GEMINI_API_KEY_STORAGE = 'miruta_gemini_api_key';
const DEFAULT_PROJECT_ID = 'projects/696217047962';
const DEFAULT_PROJECT_NUMBER = '696217047962';

interface ModelUsageCounter {
  minuteKey: string;
  requestsThisMinute: number;
  dayKey: string;
  requestsToday: number;
  cooldownUntilMs: number;
}

type QuotaStoreMap = Record<GeminiFreeModelId, ModelUsageCounter>;

function getCurrentMinuteKey(): string {
  return new Date().toISOString().slice(0, 16); // 'YYYY-MM-DDTHH:mm'
}

function getCurrentDayKey(): string {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function loadQuotaStore(): QuotaStoreMap {
  const minuteKey = getCurrentMinuteKey();
  const dayKey = getCurrentDayKey();

  const empty: QuotaStoreMap = {
    'gemini-2.5-flash': { minuteKey, requestsThisMinute: 0, dayKey, requestsToday: 0, cooldownUntilMs: 0 },
    'gemini-2.5-flash-lite': { minuteKey, requestsThisMinute: 0, dayKey, requestsToday: 0, cooldownUntilMs: 0 },
    'gemini-2.0-flash': { minuteKey, requestsThisMinute: 0, dayKey, requestsToday: 0, cooldownUntilMs: 0 },
    'gemini-2.0-flash-lite': { minuteKey, requestsThisMinute: 0, dayKey, requestsToday: 0, cooldownUntilMs: 0 },
    'gemini-1.5-flash': { minuteKey, requestsThisMinute: 0, dayKey, requestsToday: 0, cooldownUntilMs: 0 },
  };

  if (typeof window === 'undefined') return empty;

  try {
    const raw = localStorage.getItem(QUOTA_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<QuotaStoreMap>;

    for (const spec of FREE_TIER_MODEL_POOL) {
      const entry = parsed[spec.id];
      if (entry) {
        empty[spec.id] = {
          minuteKey,
          requestsThisMinute: entry.minuteKey === minuteKey ? Number(entry.requestsThisMinute || 0) : 0,
          dayKey,
          requestsToday: entry.dayKey === dayKey ? Number(entry.requestsToday || 0) : 0,
          cooldownUntilMs: Number(entry.cooldownUntilMs || 0),
        };
      }
    }
    return empty;
  } catch {
    return empty;
  }
}

function saveQuotaStore(store: QuotaStoreMap): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent('miruta-quota-updated'));
  } catch {
    // Ignore storage write errors
  }
}

export function getSelectedModelPreference(): ModelSelectionPreference {
  if (typeof window === 'undefined') return 'auto';
  const saved = localStorage.getItem(MODEL_PREF_STORAGE_KEY) as ModelSelectionPreference | null;
  if (!saved) return 'auto';
  if (saved === 'auto' || FREE_TIER_MODEL_POOL.some((m) => m.id === saved)) {
    return saved;
  }
  return 'auto';
}

export function setSelectedModelPreference(pref: ModelSelectionPreference): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(MODEL_PREF_STORAGE_KEY, pref);
  window.dispatchEvent(new CustomEvent('miruta-quota-updated'));
}

export interface ModelQuotaStatus {
  spec: FreeModelSpec;
  requestsThisMinute: number;
  requestsToday: number;
  remainingTodaySafe: number;
  isAvailableNow: boolean;
  inCooldown: boolean;
}

export interface QuotaGuardrailSnapshot {
  preference: ModelSelectionPreference;
  activeRecommendedModel: GeminiFreeModelId;
  totalSafeDailyBudget: number;
  totalUsedToday: number;
  totalRemainingToday: number;
  availablePercentToday: number;
  models: ModelQuotaStatus[];
}

export function getQuotaGuardrailSnapshot(): QuotaGuardrailSnapshot {
  const store = loadQuotaStore();
  const pref = getSelectedModelPreference();
  const now = Date.now();

  const models: ModelQuotaStatus[] = FREE_TIER_MODEL_POOL.map((spec) => {
    const u = store[spec.id];
    const inCooldown = u.cooldownUntilMs > now;
    const isAvailableNow =
      !inCooldown && u.requestsThisMinute < spec.safeMaxRPM && u.requestsToday < spec.safeMaxRPD;

    return {
      spec,
      requestsThisMinute: u.requestsThisMinute,
      requestsToday: u.requestsToday,
      remainingTodaySafe: Math.max(0, spec.safeMaxRPD - u.requestsToday),
      isAvailableNow,
      inCooldown,
    };
  });

  const totalSafeDailyBudget = FREE_TIER_MODEL_POOL.reduce((acc, m) => acc + m.safeMaxRPD, 0);
  const totalUsedToday = models.reduce((acc, m) => acc + m.requestsToday, 0);
  const totalRemainingToday = Math.max(0, totalSafeDailyBudget - totalUsedToday);
  const availablePercentToday = Math.max(
    0,
    Math.min(100, Math.round((totalRemainingToday / totalSafeDailyBudget) * 100))
  );

  let activeRecommendedModel: GeminiFreeModelId = 'gemini-2.5-flash';
  if (pref !== 'auto') {
    const preferredStatus = models.find((m) => m.spec.id === pref);
    if (preferredStatus?.isAvailableNow) {
      activeRecommendedModel = pref;
    } else {
      const firstAvail = models.find((m) => m.isAvailableNow);
      if (firstAvail) activeRecommendedModel = firstAvail.spec.id;
    }
  } else {
    const firstAvail = models.find((m) => m.isAvailableNow);
    if (firstAvail) activeRecommendedModel = firstAvail.spec.id;
  }

  return {
    preference: pref,
    activeRecommendedModel,
    totalSafeDailyBudget,
    totalUsedToday,
    totalRemainingToday,
    availablePercentToday,
    models,
  };
}

function recordModelAttempt(modelId: GeminiFreeModelId): void {
  const store = loadQuotaStore();
  const entry = store[modelId];
  entry.requestsThisMinute += 1;
  entry.requestsToday += 1;
  saveQuotaStore(store);
}

function markModelRateLimitedCooldown(modelId: GeminiFreeModelId, cooldownMs = 45000): void {
  const store = loadQuotaStore();
  const entry = store[modelId];
  entry.cooldownUntilMs = Date.now() + cooldownMs;
  saveQuotaStore(store);
}

export function getGeminiCredentials(): {
  apiKey: string;
  projectId: string;
  projectNumber: string;
  hasKey: boolean;
  keyType: 'standard_aiza' | 'oauth_aq' | 'none';
} {
  const envMap = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
  const envKey = envMap.VITE_GEMINI_API_KEY || '';
  const storedKey =
    typeof window !== 'undefined' ? localStorage.getItem(GEMINI_API_KEY_STORAGE) || '' : '';
  const apiKey = (storedKey || envKey).trim();
  const projectId = (envMap.VITE_GEMINI_PROJECT_ID || DEFAULT_PROJECT_ID).trim();
  const projectNumber = (envMap.VITE_GEMINI_PROJECT_NUMBER || DEFAULT_PROJECT_NUMBER).trim();

  let keyType: 'standard_aiza' | 'oauth_aq' | 'none' = 'none';
  if (apiKey.startsWith('AIza')) {
    keyType = 'standard_aiza';
  } else if (apiKey.length >= 12) {
    keyType = 'oauth_aq';
  }

  return {
    apiKey,
    projectId,
    projectNumber,
    hasKey: keyType !== 'none',
    keyType,
  };
}

export interface RouterInvokeOptions {
  prompt: string;
  inlineImageBase64?: string;
  expectJson?: boolean;
  timeoutMs?: number;
}

export interface RouterInvokeResult {
  text: string;
  modelUsed: GeminiFreeModelId;
}

/**
 * Ejecuta la consulta rotando automáticamente por el Pool de Modelos Gratuitos
 * verificando primero el colchón de seguridad del 20% (Costo $0 Garantizado).
 */
export async function invokeGeminiWithFreeTierRouter(
  options: RouterInvokeOptions
): Promise<RouterInvokeResult | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return null;
  }

  const creds = getGeminiCredentials();
  if (!creds.hasKey) {
    return null;
  }

  const snapshot = getQuotaGuardrailSnapshot();
  // Construir orden de cascada: primero el preferido (si está disponible), luego el resto de disponibles
  const candidateModels = snapshot.models
    .filter((m) => m.isAvailableNow)
    .sort((a, b) => {
      if (snapshot.preference !== 'auto') {
        if (a.spec.id === snapshot.preference) return -1;
        if (b.spec.id === snapshot.preference) return 1;
      }
      return 0;
    });

  if (candidateModels.length === 0) {
    // Todos los modelos alcanzaron el colchón gratuito seguro -> Conmutar a Motor Local ($0 Costo)
    return null;
  }

  const parts: Array<Record<string, unknown>> = [{ text: options.prompt }];
  if (options.inlineImageBase64) {
    const cleanBase64 = options.inlineImageBase64.replace(/^data:image\/\w+;base64,/, '');
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: cleanBase64,
      },
    });
  }

  const generationConfig: Record<string, unknown> = {
    temperature: 0.05,
    maxOutputTokens: 450,
  };
  if (options.expectJson) {
    generationConfig.responseMimeType = 'application/json';
  }

  for (const candidate of candidateModels) {
    const modelId = candidate.spec.id;
    const controller = new AbortController();
    const timeout = Math.min(options.timeoutMs ?? 1900, 1900);
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      recordModelAttempt(modelId);

      const baseEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      let url = baseEndpoint;

      if (creds.keyType === 'standard_aiza') {
        url = `${baseEndpoint}?key=${encodeURIComponent(creds.apiKey)}`;
      } else {
        url = `${baseEndpoint}?key=${encodeURIComponent(creds.apiKey)}`;
        headers['x-goog-user-project'] = creds.projectNumber;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig,
        }),
      });

      clearTimeout(timer);

      if (response.status === 429 || response.status === 503) {
        // Rate limit alcanzado en este modelo -> poner en cooldown de 45s y saltar en <50ms al siguiente modelo gratuito
        markModelRateLimitedCooldown(modelId, 45000);
        continue;
      }

      if (!response.ok) {
        // Probar siguiente modelo de la cascada si este modelo devolvió error
        markModelRateLimitedCooldown(modelId, 15000);
        continue;
      }

      const data = await response.json();
      const rawText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (rawText.trim()) {
        return {
          text: rawText.trim(),
          modelUsed: modelId,
        };
      }
    } catch {
      clearTimeout(timer);
      // En caso de timeout o fallo de red, conmutar inmediatamente
      continue;
    }
  }

  return null;
}
