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
  deliveryCoordinates?: { lat: number; lng: number } | null;
  routeOrder: number;
  status: PackageStatus;
  issueNote: string;
  auditNote?: string;
  proofPhotoBase64?: string;
  rate: number;                 // Dynamic rate (default 2200 COP)
  shiftId: string;              // YYYY-MM-DD
  scannedAt: number;            // timestamp ms
  arrivedAtPointAt?: number;    // timestamp ms for door wait timer
  waitTimeSeconds?: number;
  deliveredAt?: number;         // timestamp ms
  archivedInHistory?: boolean;
  isTestData?: boolean;
}

export type ShiftStatus = 'active' | 'paused' | 'closed';

export interface WorkShift {
  id: string;                   // YYYY-MM-DD
  date: string;                 // YYYY-MM-DD
  status?: ShiftStatus;
  startedAt: number | null;
  endTime?: number | null;
  isPaused: boolean;
  lastPauseStartedAt: number | null;
  accumulatedPausedMs: number;
  manualActiveMinutesOffset: number;
  effectiveDurationMs?: number;
  fuelExpense: number;
  otherExpense: number;
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
  date: string;
  shiftId: string;
  type: DeductionType;
  title: string;
  amount: number;
  trackingNumber?: string;
  notes: string;
  applyToJuanPdf: boolean;
}

export type PaymentMethodType = 'Nequi' | 'Bancolombia' | 'Efectivo';
export type SettlementStatus = 'pending' | 'balanced' | 'underpaid_dispute' | 'overpaid';

export interface QuincenaSettlement {
  id?: number;
  periodKey: string;
  startDate: string;
  endDate: string;
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

export type BackupTriggerType = 'pre_wipe_auto' | 'manual_checkpoint' | 'shift_close';

export interface BackupSnapshotStats {
  packagesCount: number;
  deliveredCount: number;
  shiftsCount: number;
  totalGrossCOP: number;
}

export interface BackupSnapshotRecord {
  id?: number;
  folderDate: string;           // 'YYYY-MM-DD'
  timestamp: string;            // ISO Timestamp exacto
  sessionName: string;          // ej. "Auto-Backup Pre-Borrado (14/11/2026 7:40 p.m.)"
  triggerType: BackupTriggerType;
  stats: BackupSnapshotStats;
  payloadJSON: string;          // JSON serializado con packages, shifts, deductions, settlements y settings
}

export class MiRutaDB extends Dexie {
  packages!: Table<DeliveryPackage, number>;
  shifts!: Table<WorkShift, string>;
  deductions!: Table<DeductionRecord, number>;
  settlements!: Table<QuincenaSettlement, number>;
  backupSnapshots!: Table<BackupSnapshotRecord, number>;

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
    this.version(4).stores({
      packages:
        '++id, trackingNumber, lastFourDigits, status, routeOrder, shiftId, scannedAt, deliveredAt, archivedInHistory, isTestData',
      shifts: 'id, date, status',
      deductions: '++id, date, shiftId, type, applyToJuanPdf',
      settlements: '++id, &periodKey, startDate, endDate, status',
      backupSnapshots: '++id, folderDate, timestamp, triggerType'
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

/**
 * Descarga un archivo físico .json nombrado `MiRuta_Backup_[YYYY-MM-DD]_[HH-mm].json`
 */
export function downloadSnapshotAsJSONFile(snapshot: BackupSnapshotRecord): void {
  if (typeof window === 'undefined') return;
  const dt = new Date(snapshot.timestamp);
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const fileName = `MiRuta_Backup_${snapshot.folderDate}_${hh}-${mm}.json`;

  const blob = new Blob([snapshot.payloadJSON], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Si el navegador soporta File System Access API (`showDirectoryPicker`),
 * permite elegir carpeta en el dispositivo, crea automáticamente la subcarpeta por fecha `YYYY-MM-DD`
 * y guarda allí el archivo `.json`. Si no, descarga el archivo directamente.
 */
export async function saveSnapshotToDateFolderWithDirectoryPicker(
  snapshot: BackupSnapshotRecord
): Promise<boolean> {
  const win = window as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    showDirectoryPicker?: () => Promise<any>;
  };

  if (typeof window !== 'undefined' && typeof win.showDirectoryPicker === 'function') {
    try {
      const rootDirHandle = await win.showDirectoryPicker();
      const dateDirHandle = await rootDirHandle.getDirectoryHandle(snapshot.folderDate, {
        create: true
      });
      const dt = new Date(snapshot.timestamp);
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(dt.getMinutes()).padStart(2, '0');
      const fileName = `MiRuta_Backup_${snapshot.folderDate}_${hh}-${mm}.json`;

      const fileHandle = await dateDirHandle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(snapshot.payloadJSON);
      await writable.close();
      return true;
    } catch {
      // Si el usuario cancela el selector de carpetas, cae al download estándar
    }
  }

  downloadSnapshotAsJSONFile(snapshot);
  return false;
}

/**
 * Crea un Snapshot completo de las tablas operativas y lo guarda en la bóveda protegida `db.backupSnapshots`.
 */
export async function createBackupSnapshot(options: {
  sessionName?: string;
  triggerType: BackupTriggerType;
  autoDownloadFile?: boolean;
}): Promise<BackupSnapshotRecord> {
  const now = new Date();
  const folderDate = getTodayShiftId(now);
  const isoTimestamp = now.toISOString();
  const defaultRate = getDefaultPackageRate();

  const packages = await db.packages.toArray();
  const shifts = await db.shifts.toArray();
  const deductions = await db.deductions.toArray();
  const settlements = await db.settlements.toArray();

  const delivered = packages.filter((p) => p.status === 'delivered');
  const totalGrossCOP = delivered.reduce((sum, p) => sum + (p.rate || defaultRate), 0);

  const formattedTime = now.toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const defaultTitle =
    options.triggerType === 'pre_wipe_auto'
      ? `Auto-Backup Pre-Borrado (${formattedTime})`
      : options.triggerType === 'shift_close'
      ? `Cierre de Jornada (${formattedTime})`
      : `Punto de Restauración (${formattedTime})`;

  const sessionName = options.sessionName?.trim() || defaultTitle;

  const stats: BackupSnapshotStats = {
    packagesCount: packages.length,
    deliveredCount: delivered.length,
    shiftsCount: shifts.length,
    totalGrossCOP
  };

  const fullPayload = {
    app: 'MiRuta by Christian Romero',
    version: '3.5.0',
    folderDate,
    timestamp: isoTimestamp,
    sessionName,
    triggerType: options.triggerType,
    defaultPackageRate: defaultRate,
    stats,
    packages,
    shifts,
    deductions,
    settlements
  };

  const snapshot: BackupSnapshotRecord = {
    folderDate,
    timestamp: isoTimestamp,
    sessionName,
    triggerType: options.triggerType,
    stats,
    payloadJSON: JSON.stringify(fullPayload, null, 2)
  };

  const id = await db.backupSnapshots.add(snapshot);
  snapshot.id = id;

  if (options.autoDownloadFile) {
    downloadSnapshotAsJSONFile(snapshot);
  }

  return snapshot;
}

/**
 * FUNCIÓN INNEGOCIABLE: Borra las tablas operativas (`packages`, `shifts`, `deductions`, `settlements`)
 * SOLO DESPUÉS de generar y verificar un Auto-Backup obligatorio en `db.backupSnapshots` y descargar el `.json`.
 * La tabla `db.backupSnapshots` JAMÁS se borra en esta operación.
 */
export async function wipeOperationalDatabaseWithMandatoryBackup(): Promise<BackupSnapshotRecord> {
  // Paso 1 & 2: Crear Snapshot obligatorio en `backupSnapshots` + descargar archivo `.json`
  const snapshot = await createBackupSnapshot({
    triggerType: 'pre_wipe_auto',
    autoDownloadFile: true
  });

  if (!snapshot.id) {
    throw new Error('Abortando borrado: No se pudo verificar la creación del Auto-Backup previo.');
  }

  // Paso 3: Limpiar únicamente las tablas operativas (dejando `backupSnapshots` intacta)
  await db.transaction(
    'rw',
    db.packages,
    db.shifts,
    db.deductions,
    db.settlements,
    async () => {
      await db.packages.clear();
      await db.shifts.clear();
      await db.deductions.clear();
      await db.settlements.clear();
    }
  );

  await ensureShiftExists(getTodayShiftId());
  return snapshot;
}

/**
 * Restaura una sesión completa desde un Snapshot guardado en `db.backupSnapshots`.
 * Antes de sobrescribir, guarda un micro-backup de seguridad si la base operativa actual tiene paquetes.
 */
export async function restoreSessionFromSnapshot(
  snapshotId: number
): Promise<BackupSnapshotRecord> {
  const target = await db.backupSnapshots.get(snapshotId);
  if (!target) {
    throw new Error('No se encontró el Snapshot solicitado.');
  }

  const currentCount = await db.packages.count();
  if (currentCount > 0) {
    await createBackupSnapshot({
      sessionName: `Respaldo Automático Pre-Restauración (${new Date().toLocaleTimeString('es-CO')})`,
      triggerType: 'manual_checkpoint',
      autoDownloadFile: false
    });
  }

  const parsed = JSON.parse(target.payloadJSON);

  await db.transaction(
    'rw',
    db.packages,
    db.shifts,
    db.deductions,
    db.settlements,
    async () => {
      await db.packages.clear();
      await db.shifts.clear();
      await db.deductions.clear();
      await db.settlements.clear();

      if (Array.isArray(parsed.shifts) && parsed.shifts.length > 0) {
        await db.shifts.bulkPut(parsed.shifts);
      }
      if (Array.isArray(parsed.deductions) && parsed.deductions.length > 0) {
        await db.deductions.bulkPut(parsed.deductions);
      }
      if (Array.isArray(parsed.settlements) && parsed.settlements.length > 0) {
        await db.settlements.bulkPut(parsed.settlements);
      }
      if (Array.isArray(parsed.packages) && parsed.packages.length > 0) {
        await db.packages.bulkPut(parsed.packages);
      }
    }
  );

  if (parsed.defaultPackageRate) {
    await updatePackageRateSetting(Number(parsed.defaultPackageRate), false);
  }

  return target;
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
    for (const pkg of activeShiftPkgs) {
      if (pkg.id === undefined) continue;
      if (pkg.status === 'delivered' || pkg.status === 'issue') {
        await db.packages.update(pkg.id, {
          archivedInHistory: true
        });
      }
    }

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

  // Guardar Snapshot automático de cierre de jornada en la carpeta de fecha de hoy
  await createBackupSnapshot({
    sessionName: `Cierre Jornada ${shiftId} (${delivered.length} entregados)`,
    triggerType: 'shift_close',
    autoDownloadFile: false
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
