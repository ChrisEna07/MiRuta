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
  routeOrder: number;
  status: PackageStatus;
  issueNote: string;
  proofPhotoBase64?: string;
  rate: number;                 // Dynamic rate (default 2200 COP)
  shiftId: string;              // YYYY-MM-DD
  scannedAt: number;            // timestamp ms
  deliveredAt?: number;         // timestamp ms
  arrivedAtPointAt?: number;    // timestamp ms for door wait timer
}

export interface WorkShift {
  id: string;                   // YYYY-MM-DD
  date: string;                 // YYYY-MM-DD
  startedAt: number | null;     // timestamp ms
  isPaused: boolean;
  lastPauseStartedAt: number | null;
  accumulatedPausedMs: number;
  manualActiveMinutesOffset: number;
  fuelExpense: number;          // e.g. 12000 COP
  otherExpense: number;         // e.g. 0 COP
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

export async function ensureShiftExists(shiftId: string = getTodayShiftId()): Promise<WorkShift> {
  const existing = await db.shifts.get(shiftId);
  if (existing) return existing;
  const fresh: WorkShift = {
    id: shiftId,
    date: shiftId,
    startedAt: null, // Inicia en espera hasta que el repartidor inicie ruta o marque primera entrega
    isPaused: true,
    lastPauseStartedAt: null,
    accumulatedPausedMs: 0,
    manualActiveMinutesOffset: 0,
    fuelExpense: 12000,
    otherExpense: 0,
    sectorName: 'Medellín - Ruta del Día',
    notes: ''
  };
  await db.shifts.put(fresh);
  return fresh;
}
