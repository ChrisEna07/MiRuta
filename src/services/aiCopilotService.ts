import {
  type DeliveryPackage,
  type DeductionRecord,
  getDefaultPackageRate,
} from '../db/database';
import { parseMedellinAddress, detectSameBlockClusters } from '../utils/addressParser';
import { formatCOP } from '../utils/mediaAndFeedback';
import {
  getGeminiCredentials,
  invokeGeminiWithFreeTierRouter,
} from './geminiModelRouter';

export interface GeminiClientMetadata {
  apiKey: string;
  projectId: string;
  projectNumber: string;
  hasKey: boolean;
  keyType: 'standard_aiza' | 'oauth_aq' | 'none';
}

export function getGeminiClientMetadata(): GeminiClientMetadata {
  return getGeminiCredentials();
}

/**
 * Cliente HTTP conectado al Enrutador Multi-Modelo Free-Tier (`geminiModelRouter.ts`)
 * con Escudo de Costo $0 (colchón del 20% antes del límite gratuito).
 */
export async function invokeGeminiFlashModel(options: {
  prompt: string;
  base64Jpeg?: string;
  expectJson?: boolean;
  timeoutMs?: number;
}): Promise<string | null> {
  const res = await invokeGeminiWithFreeTierRouter({
    prompt: options.prompt,
    inlineImageBase64: options.base64Jpeg,
    expectJson: options.expectJson,
    timeoutMs: options.timeoutMs ?? 4500,
  });
  return res ? res.text : null;
}

// ============================================================================
// A) SUPER-INTÉRPRETE DE DIRECCIONES DIFÍCILES Y COMUNAS DE MEDELLÍN
// ============================================================================

export interface MedellinAddressIntelligence {
  normalizedAddress: string;
  inferredNeighborhood: string;
  comunaName: string;
  terrainWarning: string;
  isSteepHillOrAlley: boolean;
  interiorOrApt: string;
}

/**
 * Infiere el barrio/comuna de Medellín, normaliza errores tipográficos de Shein/Temu
 * y advierte si es zona de loma pronunciada o pasaje peatonal.
 */
export function inferMedellinComunaAndNormalizeAddress(
  rawInput: string,
  currentNeighborhood = 'Medellín'
): MedellinAddressIntelligence {
  const cleanRaw = (rawInput || '').trim();
  const parsed = parseMedellinAddress(cleanRaw, currentNeighborhood);

  // Extraer interior / apartamento / torre / casa si existe
  const intMatch = cleanRaw.match(
    /\b(apto|apartamento|ap|int|interior|torre|tr|bloque|bl|casa|local|piso)\s*([0-9a-z\-]+)/i
  );
  const interiorOrApt = intMatch
    ? `${intMatch[1].charAt(0).toUpperCase() + intMatch[1].slice(1).toLowerCase()} ${intMatch[2].toUpperCase()}`
    : '';

  // Construir dirección normalizada limpia
  let normalizedAddress = cleanRaw;
  if (parsed.mainNum > 0 && parsed.secNum > 0) {
    const base = `${parsed.mainType} ${parsed.mainNum}${parsed.mainLetter} # ${parsed.secNum}${parsed.secLetter} - ${parsed.plate}`;
    normalizedAddress = interiorOrApt ? `${base} (${interiorOrApt})` : base;
  }

  // Inferir Comuna y Barrio según cuadrícula vial de Medellín (Calles y Carreras)
  const calle = parsed.mainType === 'CL' ? parsed.mainNum : parsed.secNum;
  const carrera = parsed.mainType === 'CR' ? parsed.mainNum : parsed.secNum;
  const isSur =
    /\bSUR\b/i.test(cleanRaw) || /\b(ENVIGADO|ITAGUI|ITAGÜÍ|SABANETA|POBLADO|GUAYABAL)\b/i.test(cleanRaw);

  let inferredNeighborhood = currentNeighborhood || 'Medellín';
  let comunaName = 'Valle de Aburrá';
  let terrainWarning = '🛣️ Vía principal urbana de acceso normal en moto';
  let isSteepHillOrAlley = false;

  if (calle >= 85 && calle <= 125 && carrera >= 38 && carrera <= 55 && !isSur) {
    inferredNeighborhood = 'Popular / Santa Cruz / Aranjuez (Nororiental)';
    comunaName = 'Comuna 1 - 2 - 4 (Nororiental)';
    if (carrera <= 46 && calle >= 95) {
      terrainWarning =
        '⛰️ Zona de loma pronunciada y pasajes escalonados (Carrera 43C / Calle 100+). Verifica nomenclatura y timbra con pre-aviso.';
      isSteepHillOrAlley = true;
    } else {
      terrainWarning = '⛰️ Sector con pendientes moderadas a fuertes (Nororiental).';
      isSteepHillOrAlley = true;
    }
  } else if (calle >= 88 && calle <= 115 && carrera >= 62 && carrera <= 85 && !isSur) {
    inferredNeighborhood = 'Castilla / Doce de Octubre';
    comunaName = 'Comuna 5 - 6 (Noroccidental)';
    terrainWarning =
      carrera >= 74
        ? '⛰️ Parte alta Noroccidental (lomas pronunciadas hacia Picacho).'
        : '🛣️ Cuadrícula densa residencial (excelente para barrido en Serpiente).';
    isSteepHillOrAlley = carrera >= 74;
  } else if (calle >= 1 && calle <= 25 && carrera >= 25 && carrera <= 48) {
    inferredNeighborhood = 'El Poblado';
    comunaName = 'Comuna 14 (El Poblado)';
    terrainWarning =
      carrera <= 35
        ? '⛰️ Loma de El Poblado (Las Palmas / Los Balsos / Tesoro) + Unidades con portería.'
        : '🏢 Zona de edificios y unidades cerradas (usa Pre-aviso WhatsApp para dejar en portería).';
    isSteepHillOrAlley = carrera <= 35;
  } else if (calle >= 32 && calle <= 55 && carrera >= 63 && carrera <= 84 && !isSur) {
    inferredNeighborhood = 'Laureles - Estadio';
    comunaName = 'Comuna 11 (Laureles)';
    terrainWarning = '🟢 Terreno plano y circulares rápidas (alta velocidad de entrega).';
  } else if (calle >= 1 && calle <= 33 && carrera >= 65 && carrera <= 89) {
    inferredNeighborhood = 'Belén';
    comunaName = 'Comuna 16 (Belén)';
    terrainWarning =
      carrera >= 82
        ? '⛰️ Parte alta de Belén (Altavista / Rincón - callejones y lomas).'
        : '🛣️ Sector residencial mixto de buen acceso.';
    isSteepHillOrAlley = carrera >= 82;
  } else if (calle >= 44 && calle <= 67 && carrera >= 42 && carrera <= 58 && !isSur) {
    inferredNeighborhood = 'La Candelaria (Centro) / Boston';
    comunaName = 'Comuna 10 (Centro)';
    terrainWarning = '🚦 Alto tráfico vehicular y zonas de parqueo restringido.';
  } else if (calle >= 50 && calle <= 85 && carrera >= 75 && carrera <= 95 && !isSur) {
    inferredNeighborhood = 'Robledo';
    comunaName = 'Comuna 7 (Robledo)';
    terrainWarning = '⛰️ Sector de lomas y urbanizaciones en ladera.';
    isSteepHillOrAlley = true;
  }

  return {
    normalizedAddress,
    inferredNeighborhood,
    comunaName,
    terrainWarning,
    isSteepHillOrAlley,
    interiorOrApt,
  };
}

// ============================================================================
// B) DIAGNÓSTICO IA DE RENTABILIDAD EN TIEMPO REAL (`ProfitabilityMeter.tsx`)
// ============================================================================

export interface ShiftAICopilotDiagnosis {
  headline: string;
  packagesToBreakEvenFuel: number;
  packagesToTargetGoal: number;
  estimatedFinishTimeStr: string;
  paceAnalysisText: string;
  actionableRecommendation: string;
  fullStreamingText: string;
  usedCloudAI: boolean;
}

export async function generateShiftProfitabilityDiagnosis(params: {
  packages: DeliveryPackage[];
  activeMinutes: number;
  fuelExpense: number;
  targetDailyNetCOP?: number;
}): Promise<ShiftAICopilotDiagnosis> {
  const defaultRate = getDefaultPackageRate();
  const targetNet = params.targetDailyNetCOP ?? 75000;

  const unarchived = params.packages.filter((p) => !p.archivedInHistory);
  const delivered = params.packages.filter((p) => p.status === 'delivered');
  const pending = unarchived.filter((p) => p.status === 'pending' || p.status === 'in_progress');

  const grossToday = delivered.reduce((s, p) => s + (p.rate || defaultRate), 0);
  const remainingForFuel = Math.max(0, params.fuelExpense - grossToday);
  const packagesToBreakEvenFuel = Math.ceil(remainingForFuel / defaultRate);

  const totalNeededGross = params.fuelExpense + targetNet;
  const remainingForTarget = Math.max(0, totalNeededGross - grossToday);
  const packagesToTargetGoal = Math.ceil(remainingForTarget / defaultRate);

  // Calcular ritmo promedio (minutos por paquete)
  const avgMinsPerPkg =
    delivered.length > 0 && params.activeMinutes >= 3
      ? Math.max(2.5, Math.min(20, params.activeMinutes / delivered.length))
      : 7.5;

  const remainingMinutesNeeded = Math.round(pending.length * avgMinsPerPkg);
  const finishDate = new Date(Date.now() + remainingMinutesNeeded * 60000);
  const finishTimeFormatted = finishDate.toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const estimatedFinishTimeStr =
    pending.length > 0
      ? `Al ritmo actual de 1 paquete cada ${avgMinsPerPkg.toFixed(1)} min, terminarás los ${
          pending.length
        } paquetes restantes hacia las ${finishTimeFormatted}.`
      : '¡Ya completaste todos los paquetes pendientes de tu cola actual!';

  // Detectar paquetes agrupados en la misma cuadra
  const clusters = detectSameBlockClusters(pending);
  let actionableRecommendation =
    'Usa el botón de Pre-aviso WhatsApp 1-Click antes de arrancar la moto hacia el siguiente punto para reducir la espera en puerta a menos de 45 segundos.';

  if (clusters.length > 0) {
    const topCluster = clusters[0];
    actionableRecommendation = `Agrupa de inmediato los ${topCluster.packages.length} paquetes de la cuadra ${topCluster.humanLabel} (${topCluster.packages
      .map((p) => `#${p.lastFourDigits}`)
      .join(', ')}) en una sola parada para ahorrar ~${topCluster.packages.length * 5} min y gasolina.`;
  }

  const paceAnalysisText =
    packagesToBreakEvenFuel > 0
      ? `Te faltan exactamente ${packagesToBreakEvenFuel} paquete(s) para librar los ${formatCOP(
          params.fuelExpense
        )} de gasolina de hoy, y ${packagesToTargetGoal} paquete(s) para alcanzar una meta libre de ${formatCOP(
          targetNet
        )}.`
      : `✅ ¡Gasolina del día 100% librada! Ya llevas ${formatCOP(
          grossToday - params.fuelExpense
        )} libres en el bolsillo (${delivered.length} entregados).`;

  let fullStreamingText = `📊 DIAGNÓSTICO TÁCTICO IA MIRUTA:\n• ${paceAnalysisText}\n• ⏱️ Proyección de Cierre: ${estimatedFinishTimeStr}\n• 💡Jugada Maestra: ${actionableRecommendation}`;
  let usedCloudAI = false;

  // Intentar enriquecer con Gemini 2.5 Flash si está online
  const aiPrompt = `Eres el Copiloto Logístico IA de Christian Romero en Medellín (repartidor en moto de paquetes iMile a $${defaultRate} COP/paq).
Datos en vivo de hoy:
- Entregados hoy: ${delivered.length} paquetes (Bruto: $${grossToday} COP)
- Pendientes en ruta: ${pending.length} paquetes
- Gasto gasolina hoy: $${params.fuelExpense} COP
- Ritmo actual: ${avgMinsPerPkg.toFixed(1)} min por paquete
- Hora estimada de fin: ${finishTimeFormatted}
- Cuadras con entregas múltiples: ${
    clusters.length > 0
      ? clusters.map((c) => `${c.humanLabel} (${c.packages.length} paq)`).join(', ')
      : 'Ninguna'
  }
Redacta en español colombiano un diagnóstico táctico ultra conciso (máximo 3 viñetas cortas con emojis) indicando: 1) Cuánto lleva libre o cuántos paquetes faltan para librar gasolina, 2) A qué hora termina el lote actual a este ritmo, y 3) Un consejo táctico de calle.`;

  const cloudResponse = await invokeGeminiFlashModel({
    prompt: aiPrompt,
    expectJson: false,
    timeoutMs: 4500,
  });

  if (cloudResponse) {
    fullStreamingText = cloudResponse;
    usedCloudAI = true;
  }

  return {
    headline:
      packagesToBreakEvenFuel === 0
        ? '🟢 Gasolina Librada • En Zona de Ganancia Neta'
        : `⚡ Faltan ${packagesToBreakEvenFuel} entregas para librar gasolina`,
    packagesToBreakEvenFuel,
    packagesToTargetGoal,
    estimatedFinishTimeStr,
    paceAnalysisText,
    actionableRecommendation,
    fullStreamingText,
    usedCloudAI,
  };
}

// ============================================================================
// C) AUDITORÍA IA DE QUINCENA Y REDACTOR DE RECLAMO / SUSTENTO AL SR. JUAN
// ============================================================================

export async function generateQuincenaAuditClaimText(params: {
  periodLabel: string;
  employerName: string;
  contractorName: string;
  deliveredPackages: DeliveryPackage[];
  deductions: DeductionRecord[];
  expectedNetCOP: number;
  actualPaidCOP: number;
  reportedPkgsByCompany?: number;
  paymentMethod: string;
}): Promise<{ messageText: string; usedCloudAI: boolean }> {
  const defaultRate = getDefaultPackageRate();
  const diff = params.actualPaidCOP - params.expectedNetCOP;
  const absDiff = Math.abs(diff);
  const missingPkgsEquiv = diff < 0 ? Math.round(absDiff / defaultRate) : 0;

  // Agrupar conteo por fecha para sustento irrefutable
  const byDate = new Map<string, number>();
  for (const pkg of params.deliveredPackages) {
    const d = pkg.deliveredAt
      ? new Date(pkg.deliveredAt).toISOString().slice(0, 10)
      : pkg.shiftId;
    byDate.set(d, (byDate.get(d) || 0) + 1);
  }
  const dateBreakdown = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, c]) => `  • ${d}: ${c} paq.`)
    .join('\n');

  const sampleGuides = params.deliveredPackages
    .slice(0, 8)
    .map((p) => `#${p.lastFourDigits} (${p.trackingNumber})`)
    .join(', ');

  const deductionsLine =
    params.deductions.length > 0
      ? `Descuentos/Adelantos registrados: -${formatCOP(
          params.deductions.reduce((s, d) => s + d.amount, 0),
          true
        )} (${params.deductions.map((d) => d.title).join(', ')})`
      : 'Sin descuentos ni multas pendientes';

  let deterministicText = '';

  if (params.actualPaidCOP > 0 && diff < 0) {
    deterministicText = [
      `Hola *${params.employerName}*, cordial saludo. Espero que estés muy bien.`,
      ``,
      `Te comparto el soporte de auditoría de *${params.periodLabel}* generado desde mi sistema *MiRuta*:`,
      `📦 *Total Entregas Verificadas:* ${params.deliveredPackages.length} paquetes (a ${formatCOP(defaultRate)} c/u)`,
      `📅 *Desglose por jornada:*`,
      dateBreakdown || '  • Registro consolidado en anexo PDF',
      `📋 *${deductionsLine}*`,
      `💰 *Valor Neto a Pagar Calculado:* ${formatCOP(params.expectedNetCOP, true)}`,
      `📲 *Pago Recibido (${params.paymentMethod}):* ${formatCOP(params.actualPaidCOP, true)}`,
      `⚠️ *Saldo Pendiente por Conciliar:* *-${formatCOP(absDiff, true)}* (equivalente a *~${missingPkgsEquiv} paquetes entregados*${
        params.reportedPkgsByCompany !== undefined
          ? `, ya que en planilla figuran ${params.reportedPkgsByCompany} vs. ${params.deliveredPackages.length} entregados`
          : ''
      }).`,
      ``,
      `🔍 *Muestra de guías entregadas con GPS y hora exacta:* ${sampleGuides}${
        params.deliveredPackages.length > 8 ? '...' : ''
      }`,
      ``,
      `Te adjunto el PDF formal con el listado completo de guías y horas de entrega para que me ayudes por favor a validar el ajuste de los *${formatCOP(
        absDiff,
        true
      )}*. ¡Muchas gracias!`,
      `— *${params.contractorName}*`,
    ].join('\n');
  } else {
    deterministicText = [
      `Hola *${params.employerName}*, cordial saludo.`,
      ``,
      `Te envío la relación formal de cobro correspondiente a *${params.periodLabel}* registrada en *MiRuta*:`,
      `✅ *Total Paquetes Entregados:* ${params.deliveredPackages.length} paquetes`,
      `📅 *Detalle por fechas trabajadas:*`,
      dateBreakdown || '  • Sin entregas en el rango seleccionado',
      `📋 *${deductionsLine}*`,
      `💵 *GRAN TOTAL NETO A LIQUIDAR:* *${formatCOP(params.expectedNetCOP, true)}*`,
      ``,
      `Quedo atento a la confirmación de transferencia por *${params.paymentMethod}* y adjunto el PDF con el anexo verificable de cada guía iMile entregada. ¡Muchas gracias!`,
      `— *${params.contractorName}*`,
    ].join('\n');
  }

  return {
    messageText: deterministicText,
    usedCloudAI: false,
  };
}
