import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { db, type BackupSnapshotRecord } from '../db/database';

const SUPABASE_URL_KEY = 'miruta_supabase_url';
const SUPABASE_ANON_KEY = 'miruta_supabase_anon_key';
const LAST_SYNC_TS_KEY = 'miruta_last_cloud_sync_ts';

// Credenciales públicas preconfiguradas del proyecto Supabase de Christian Romero
const DEFAULT_PUBLIC_SUPABASE_URL = 'https://qsoekxdghdklwduwleuh.supabase.co';
const DEFAULT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_yCl3Jo-GwtoIBjtuqhTfcw_09FPfbPP';

export interface SupabaseConfigInfo {
  url: string;
  anonKey: string;
  projectRef: string;
  isConfigured: boolean;
  lastSyncAt: number | null;
}

export function getSupabaseConfig(): SupabaseConfigInfo {
  const envUrl = import.meta.env.VITE_SUPABASE_URL || DEFAULT_PUBLIC_SUPABASE_URL;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_PUBLIC_SUPABASE_ANON_KEY;

  const localUrl =
    typeof window !== 'undefined' ? localStorage.getItem(SUPABASE_URL_KEY) || '' : '';
  const localKey =
    typeof window !== 'undefined' ? localStorage.getItem(SUPABASE_ANON_KEY) || '' : '';

  const url = (localUrl || envUrl).trim();
  const anonKey = (localKey || envKey).trim();
  const lastSyncRaw =
    typeof window !== 'undefined' ? localStorage.getItem(LAST_SYNC_TS_KEY) : null;

  const matchRef = url.match(/https:\/\/([^.]+)\.supabase\.co/i);
  const projectRef = matchRef ? matchRef[1] : 'supabase';

  return {
    url,
    anonKey,
    projectRef,
    isConfigured: Boolean(url && anonKey && url.startsWith('https://')),
    lastSyncAt: lastSyncRaw ? Number(lastSyncRaw) : null
  };
}

export function saveSupabaseCredentials(url: string, anonKey: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SUPABASE_URL_KEY, url.trim());
  localStorage.setItem(SUPABASE_ANON_KEY, anonKey.trim());
}

export function resetToDefaultSupabaseCredentials(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SUPABASE_URL_KEY);
  localStorage.removeItem(SUPABASE_ANON_KEY);
}

function getClient(): SupabaseClient | null {
  const cfg = getSupabaseConfig();
  if (!cfg.isConfigured) return null;
  try {
    return createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false }
    });
  } catch {
    return null;
  }
}

export interface SyncResult {
  ok: boolean;
  message: string;
  syncedPackages: number;
  syncedShifts: number;
  syncedSnapshots: number;
}

/**
 * Sube un Snapshot específico a la tabla `backup_snapshots` en Supabase.
 */
export async function pushSnapshotToSupabase(snapshot: BackupSnapshotRecord): Promise<boolean> {
  const client = getClient();
  if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;

  try {
    let parsedPayload: unknown = {};
    try {
      parsedPayload = JSON.parse(snapshot.payloadJSON);
    } catch {
      parsedPayload = { raw: snapshot.payloadJSON };
    }

    const { error } = await client.from('backup_snapshots').upsert(
      [
        {
          local_id: snapshot.id || null,
          folder_date: snapshot.folderDate,
          timestamp: snapshot.timestamp,
          session_name: snapshot.sessionName,
          trigger_type: snapshot.triggerType,
          stats: snapshot.stats,
          payload_json: parsedPayload
        }
      ],
      { onConflict: 'timestamp' }
    );
    return !error;
  } catch {
    return false;
  }
}

/**
 * Sincroniza en segundo plano los datos de IndexedDB (Dexie.js) hacia Supabase (`qsoekxdghdklwduwleuh`).
 */
export async function syncToSupabase(silent = true): Promise<SyncResult> {
  const client = getClient();
  if (!client) {
    return {
      ok: false,
      message: 'Modo 100% Local activo.',
      syncedPackages: 0,
      syncedShifts: 0,
      syncedSnapshots: 0
    };
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      ok: false,
      message: 'Sin conexión a internet. Tus datos están seguros en IndexedDB local.',
      syncedPackages: 0,
      syncedShifts: 0,
      syncedSnapshots: 0
    };
  }

  try {
    const allPackages = (await db.packages.toArray()).filter((p) => !p.isTestData);
    const allShifts = await db.shifts.toArray();
    const allDeductions = await db.deductions.toArray();
    const allSettlements = await db.settlements.toArray();
    const allSnapshots = await db.backupSnapshots.toArray();

    // 1. Upsert Shifts
    if (allShifts.length > 0) {
      const shiftRows = allShifts.map((s) => ({
        id: s.id,
        date: s.date,
        status: s.status || (s.isPaused ? 'paused' : 'active'),
        started_at: s.startedAt,
        end_time: s.endTime || null,
        is_paused: s.isPaused,
        last_pause_started_at: s.lastPauseStartedAt,
        accumulated_paused_ms: s.accumulatedPausedMs || 0,
        manual_active_minutes_offset: s.manualActiveMinutesOffset || 0,
        effective_duration_ms: s.effectiveDurationMs || 0,
        fuel_expense: s.fuelExpense ?? 12000,
        other_expense: s.otherExpense ?? 0,
        closed_delivered_count: s.closedDeliveredCount ?? 0,
        closed_gross_cop: s.closedGrossCOP ?? 0,
        closed_net_cop: s.closedNetCOP ?? 0,
        sector_name: s.sectorName || 'Medellín',
        notes: s.notes || '',
        updated_at: new Date().toISOString()
      }));
      const { error: shiftErr } = await client.from('shifts').upsert(shiftRows, { onConflict: 'id' });
      if (shiftErr && !silent) throw shiftErr;
    }

    // 2. Upsert Packages
    if (allPackages.length > 0) {
      const pkgRows = allPackages.map((p) => ({
        local_id: p.id,
        tracking_number: p.trackingNumber,
        last_four_digits: p.lastFourDigits,
        recipient_name: p.recipientName,
        recipient_phone: p.recipientPhone,
        raw_address: p.rawAddress,
        parsed_address: p.parsedAddress,
        coordinates: p.coordinates,
        delivery_coordinates: p.deliveryCoordinates || null,
        route_order: p.routeOrder,
        status: p.status,
        issue_note: p.issueNote || '',
        audit_note: p.auditNote || '',
        proof_photo_base64: p.proofPhotoBase64 || null,
        rate: p.rate || 2200,
        shift_id: p.shiftId,
        scanned_at: p.scannedAt,
        arrived_at_point_at: p.arrivedAtPointAt || null,
        wait_time_seconds: p.waitTimeSeconds || 0,
        delivered_at: p.deliveredAt || null,
        archived_in_history: Boolean(p.archivedInHistory),
        is_test_data: Boolean(p.isTestData),
        updated_at: new Date().toISOString()
      }));
      const { error: pkgErr } = await client
        .from('packages')
        .upsert(pkgRows, { onConflict: 'tracking_number,shift_id' });
      if (pkgErr && !silent) throw pkgErr;
    }

    // 3. Upsert Deductions
    if (allDeductions.length > 0) {
      const dedRows = allDeductions.map((d) => ({
        local_id: d.id,
        date: d.date,
        shift_id: d.shiftId,
        type: d.type,
        title: d.title,
        amount: d.amount,
        tracking_number: d.trackingNumber || null,
        notes: d.notes || '',
        apply_to_juan_pdf: d.applyToJuanPdf,
        updated_at: new Date().toISOString()
      }));
      await client.from('deductions').upsert(dedRows, { onConflict: 'local_id' });
    }

    // 4. Upsert Settlements
    if (allSettlements.length > 0) {
      const setRows = allSettlements.map((st) => ({
        period_key: st.periodKey,
        start_date: st.startDate,
        end_date: st.endDate,
        expected_gross: st.expectedGross,
        total_deductions: st.totalDeductions,
        expected_net: st.expectedNet,
        actual_paid_amount: st.actualPaidAmount,
        paid_packages_count_reported_by_company: st.paidPackagesCountReportedByCompany ?? null,
        payment_date: st.paymentDate,
        payment_method: st.paymentMethod,
        status: st.status,
        notes: st.notes || '',
        updated_at: new Date().toISOString()
      }));
      await client.from('settlements').upsert(setRows, { onConflict: 'period_key' });
    }

    // 5. Upsert Backup Snapshots (últimos 15 snapshots para rapidez)
    const recentSnapshots = allSnapshots.slice(-15);
    for (const snap of recentSnapshots) {
      await pushSnapshotToSupabase(snap);
    }

    const nowTs = Date.now();
    if (typeof window !== 'undefined') {
      localStorage.setItem(LAST_SYNC_TS_KEY, String(nowTs));
    }

    return {
      ok: true,
      message: `✅ Sincronizado con Supabase (${allPackages.length} paq., ${allShifts.length} jornadas, ${recentSnapshots.length} backups).`,
      syncedPackages: allPackages.length,
      syncedShifts: allShifts.length,
      syncedSnapshots: recentSnapshots.length
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? `Aviso Supabase: ${err.message} (Ejecuta supabase_schema.sql en el SQL Editor si es tu primera vez).`
          : 'No se pudo sincronizar con Supabase. Tus datos siguen 100% seguros en IndexedDB local.',
      syncedPackages: 0,
      syncedShifts: 0,
      syncedSnapshots: 0
    };
  }
}
