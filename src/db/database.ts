import Dexie, { type Table } from 'dexie';

export type RoadMainType = 'CL' | 'CR' | 'TV' | 'DG' | 'AV' | 'CQ' | 'OTRO';

export interface ParsedMedellinAddress {
  mainType: RoadMainType;
  mainNum: number;
  mainLetter: string;
  isSur: boolean;
  secNum: number;
  secLetter: string;
  plate: number;
  neighborhood: string;
  apartmentOrUnit?: string;
  blockKey: string;
}

export type PackageStatus = 'pending' | 'in_progress' | 'delivered' | 'issue';

export interface DeliveryPackage {
  id?: number;
  trackingNumber: string;       // e.g. "6103026696672"
  lastFourDigits: string;       // e.g. "6672"
  recipientName: string;        // e.g. "Alba Lucia Lopera Castrillon"
  recipientPhone: string;       // Normalized e.g. "573001234567"
  rawAddress: string;           // e.g. "Carrera 43c #100 52"
  parsedAddress: ParsedMedellinAddress;
  coordinates: { lat: number; lng: number } | null;
  deliveryCoordinates?: { lat: number; lng: number } | null; // Coordenadas GPS exactas del punto de entrega
  routeOrder: number;
  status: PackageStatus;
  issueNote: string;
  auditNote?: string;           // Nota aclaratoria posterior para auditoría/reclamos
  proofPhotoBase64?: string;
  rate: number;                 // Dynamic rate (default 2200 COP)
  shiftId: string;              // YYYY-MM-DD
  scannedAt: number;            // timestamp ms
  arrivedAtPointAt?: number;    // timestamp ms for door wait timer
  waitTimeSeconds?: number;     // Segundos que se esperó en puerta antes de entregar
  deliveredAt?: number;         // timestamp ms
  archivedInHistory?: boolean;  // true cuando se cierra formalmente la jornada
  isTestData?: boolean;         // true si fue generado desde el Laboratorio de Pruebas
}

export type ShiftStatus = 'active' | 'paused' | 'closed';

export interface WorkShift {
  id: string;                   // YYYY-MM-DD
  date: string;                 // YYYY-MM-DD
  status?: ShiftStatus;         // 'active' | 'paused' | 'closed'
  startedAt: number | null;     // timestamp ms
  endTime?: number | null;      // timestamp ms de cierre formal de jornada
  isPaused: boolean;
  lastPauseStartedAt: number | null;
  accumulatedPausedMs: number;
  manualActiveMinutesOffset: number;
  effectiveDurationMs?: number; // duración congelada al cerrar jornada
  fuelExpense: number;          // e.g. 12000 COP
  otherExpense: number;         // e.g. 0 COP
  closedDeliveredCount?: number;
  closedGrossCOP?: number;
  closedNetCOP?: number;
  sectorName: string;
  notes: string;
}

export type DeductionType =
  | 'lost_package'
  | 'fake_signature'
  | 'advance_payment'
  | 'manual_discount';

export interface DeductionRecord {
  id?: number;
  date: string;                 // YYYY-MM-DD
  shiftId: string;              // YYYY-MM-DD
  type: DeductionType;
  title: string;
  amount: number;               // COP (e.g. 120000 or 600000)
  trackingNumber?: string;
  notes: string;
  applyToJuanPdf: boolean;
}

export type PaymentMethodType = 'Nequi' | 'Bancolombia' | 'Efectivo';
export type SettlementStatus = 'pending' | 'balanced' | 'underpaid_dispute' | 'overpaid';

export interface QuincenaSettlement {
  id?: number;
  periodKey: string;            // e.g. "2026-11-Q1"
  startDate: string;            // YYYY-MM-DD
  endDate: string;              // YYYY-MM-DD
  expectedGross: number;
  totalDeductions: number;
  expectedNet: number;
  actualPaidAmount: number;
  paidPackagesCountReportedByCompany?: number;
  paymentDate: string;
  paymentMethod: PaymentMethodType;
  status: SettlementStatus;
  notes: string;
}

export class MiRutaDB extends Dexie {
  packages!: Table<DeliveryPackage, number>;
  shifts!: Table<WorkShift, string>;
  deductions!: Table<DeductionRecord, number>;
  settlements!: Table<QuincenaSettlement, number>;

  constructor() {
    super('iMileTrackProDB_v1');
    this.version(1).stores({
      packages: '++id, trackingNumber, lastFourDigits, status, routeOrder, shiftId, scannedAt, deliveredAt',
      shifts: 'id, date'
    });
    this.version(2).stores({
      packages: '++id, trackingNumber, lastFourDigits, status, routeOrder, shiftId, scannedAt, deliveredAt',
      shifts: 'id, date',
      deductions: '++id, date, shiftId, type, applyToJuanPdf',
      settlements: '++id, &periodKey, startDate, endDate, status'
    });
    this.version(3).stores({
      packages:
        '++id, trackingNumber, lastFourDigits, status, routeOrder, shiftId, scannedAt, deliveredAt, archivedInHistory, isTestData',
      shifts: 'id, date, status',
      deductions: '++id, date, shiftId, type, applyToJuanPdf',
      settlements: '++id, &periodKey, startDate, endDate, status'
    });
  }
}

export const db = new MiRutaDB();

const RATE_STORAGE_KEY = 'miruta_default_package_rate_cop';

export function getDefaultPackageRate(): number {
  if (typeof window === 'undefined') return 2200;
  const raw = localStorage.getItem(RATE_STORAGE_KEY);
  const parsed = raw ? parseInt(raw, 10) : 2200;
  return parsed > 0 ? parsed : 2200;
}

export async function updatePackageRateSetting(
  newRate: number,
  recalculateCurrentShift: boolean,
  shiftId: string = getTodayShiftId()
): Promise<void> {
  const cleanRate = Math.max(100, Math.round(newRate || 2200));
  if (typeof window !== 'undefined') {
    localStorage.setItem(RATE_STORAGE_KEY, String(cleanRate));
    window.dispatchEvent(new CustomEvent('miruta-rate-updated', { detail: cleanRate }));
  }

  if (recalculateCurrentShift) {
    const todayPkgs = await db.packages.where('shiftId').equals(shiftId).toArray();
    await db.transaction('rw', db.packages, async () => {
      for (const pkg of todayPkgs) {
        if (pkg.id !== undefined) {
          await db.packages.update(pkg.id, { rate: cleanRate });
        }
      }
    });
  }
}

/**
 * Normaliza números telefónicos de Colombia para WhatsApp y llamada directa.
 */
export function normalizeColombianPhone(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('573') && digits.length === 12) {
    return digits;
  }
  if (digits.startsWith('3') && digits.length === 10) {
    return `57${digits}`;
  }
  if (digits.length > 10 && digits.includes('3')) {
    const idx = digits.indexOf('3');
    const sub = digits.slice(idx, idx + 10);
    if (sub.length === 10) return `57${sub}`;
  }
  return digits.startsWith('57') ? digits : `57${digits}`;
}

export function extractLastFourDigits(tracking: string): string {
  const clean = (tracking || '').trim();
  if (clean.length <= 4) return clean.padStart(4, '0');
  return clean.slice(-4);
}

export function getTodayShiftId(dateObj: Date = new Date()): string {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getNextDayShiftId(currentShiftId: string): string {
  const parts = currentShiftId.split('-').map(Number);
  const d =
    parts.length === 3
      ? new Date(parts[0], parts[1] - 1, parts[2] + 1)
      : new Date(Date.now() + 86400000);
  return getTodayShiftId(d);
}

export async function ensureShiftExists(shiftId: string = getTodayShiftId()): Promise<WorkShift> {
  const existing = await db.shifts.get(shiftId);
  if (existing) return existing;
  const fresh: WorkShift = {
    id: shiftId,
    date: shiftId,
    status: 'paused',
    startedAt: null,
    endTime: null,
    isPaused: true,
    lastPauseStartedAt: null,
    accumulatedPausedMs: 0,
    manualActiveMinutesOffset: 0,
    effectiveDurationMs: 0,
    fuelExpense: 12000,
    otherExpense: 0,
    sectorName: 'Medellín - Ruta del Día',
    notes: ''
  };
  await db.shifts.put(fresh);
  return fresh;
}

export type PendingPackagesAction = 'move_to_tomorrow' | 'mark_returned_to_warehouse';

export interface CloseShiftSummary {
  shiftId: string;
  endTime: number;
  effectiveDurationMs: number;
  deliveredCount: number;
  pendingCountHandled: number;
  grossCOP: number;
  fuelExpense: number;
  netCOP: number;
}

/**
 * Cierra formalmente la jornada activa ("🏁 Terminar Jornada"):
 * 1. Congela las métricas del turno (`status: 'closed'`, `endTime`, `effectiveDurationMs`).
 * 2. Archiva en el historial permanente todos los paquetes entregados o con novedad de ese turno (`archivedInHistory: true`).
 * 3. Gestiona los paquetes que quedaron pendientes según la decisión del repartidor:
 *    - `'move_to_tomorrow'`: Los pasa a la jornada de mañana manteniendo su orden.
 *    - `'mark_returned_to_warehouse'`: Los marca como `'issue'` ("Devuelto a bodega al cierre de jornada") y los archiva.
 */
export async function closeActiveShift(options: {
  shiftId: string;
  fuelExpense: number;
  pendingAction: PendingPackagesAction;
  effectiveDurationMs: number;
}): Promise<CloseShiftSummary> {
  const { shiftId, fuelExpense, pendingAction, effectiveDurationMs } = options;
  const endTime = Date.now();
  const defaultRate = getDefaultPackageRate();

  const shiftPkgs = await db.packages.where('shiftId').equals(shiftId).toArray();
  const activeShiftPkgs = shiftPkgs.filter((p) => !p.archivedInHistory);

  const delivered = activeShiftPkgs.filter((p) => p.status === 'delivered');
  const pendingOrInProgress = activeShiftPkgs.filter(
    (p) => p.status === 'pending' || p.status === 'in_progress'
  );

  const grossCOP = delivered.reduce((sum, p) => sum + (p.rate || defaultRate), 0);
  const netCOP = grossCOP - fuelExpense;
  const tomorrowShiftId = getNextDayShiftId(shiftId);

  await db.transaction('rw', db.packages, db.shifts, async () => {
    // 1. Archivar paquetes ya entregados o con novedad para limpiar la vista activa de ruta/piloto
    for (const pkg of activeShiftPkgs) {
      if (pkg.id === undefined) continue;
      if (pkg.status === 'delivered' || pkg.status === 'issue') {
        await db.packages.update(pkg.id, {
          archivedInHistory: true
        });
      }
    }

    // 2. Procesar los paquetes pendientes según la elección del usuario
    for (const pkg of pendingOrInProgress) {
      if (pkg.id === undefined) continue;
      if (pendingAction === 'move_to_tomorrow') {
        await db.packages.update(pkg.id, {
          shiftId: tomorrowShiftId,
          status: 'pending',
          arrivedAtPointAt: undefined,
          archivedInHistory: false
        });
      } else {
        await db.packages.update(pkg.id, {
          status: 'issue',
          issueNote: pkg.issueNote || 'Devuelto a bodega al cierre de jornada',
          deliveredAt: endTime,
          arrivedAtPointAt: undefined,
          archivedInHistory: true
        });
      }
    }

    // 3. Cerrar y congelar el WorkShift
    const shift = await ensureShiftExists(shiftId);
    await db.shifts.update(shift.id, {
      status: 'closed',
      isPaused: true,
      endTime,
      effectiveDurationMs,
      fuelExpense,
      closedDeliveredCount: delivered.length,
      closedGrossCOP: grossCOP,
      closedNetCOP: netCOP
    });
  });

  return {
    shiftId,
    endTime,
    effectiveDurationMs,
    deliveredCount: delivered.length,
    pendingCountHandled: pendingOrInProgress.length,
    grossCOP,
    fuelExpense,
    netCOP
  };
}
