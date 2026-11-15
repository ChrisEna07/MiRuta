import { useState, useEffect } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { db, type BackupSnapshotRecord } from '../db/database';

const SUPABASE_URL_KEY = 'miruta_supabase_url';
const SUPABASE_ANON_KEY = 'miruta_supabase_anon_key';
const LAST_SYNC_TS_KEY = 'miruta_last_cloud_sync_ts';

const DEFAULT_PUBLIC_SUPABASE_URL = 'https://qsoekxdghdklwduwleuh.supabase.co';
const DEFAULT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_yCl3Jo-GwtoIBjtuqhTfcw_09FPfbPP';

export type LiveCloudState = 'synced' | 'syncing' | 'offline_pending';

export interface CloudStatusSnapshot {
  state: LiveCloudState;
  lastSyncAt: number | null;
  detailMessage: string;
}

let currentCloudStatus: CloudStatusSnapshot = {
  state: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline_pending' : 'synced',
  lastSyncAt:
    typeof window !== 'undefined' && localStorage.getItem(LAST_SYNC_TS_KEY)
      ? Number(localStorage.getItem(LAST_SYNC_TS_KEY))
      : Date.now(),
  detailMessage: 'Conectado a Supabase'
};

const listeners = new Set<(status: CloudStatusSnapshot) => void>();

function emitCloudStatus(partial: Partial<CloudStatusSnapshot>) {
  currentCloudStatus = { ...currentCloudStatus, ...partial };
  for (const listener of listeners) {
    listener(currentCloudStatus);
  }
}

export function useCloudSyncStatus(): CloudStatusSnapshot & { relativeTimeLabel: string } {
  const [status, setStatus] = useState<CloudStatusSnapshot>(currentCloudStatus);
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const handler = (next: CloudStatusSnapshot) => setStatus(next);
    listeners.add(handler);

    const onOnline = () => {
      emitCloudStatus({ state: 'synced', detailMessage: 'Red restaurada' });
    };
    const onOffline = () => {
      emitCloudStatus({
        state: 'offline_pending',
        detailMessage: 'Guardado en Local (Pendiente subir a nube)'
      });
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const interval = setInterval(() => setNow(Date.now()), 5000);

    return () => {
      listeners.delete(handler);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(interval);
    };
  }, []);

  let relativeTimeLabel = 'Sincronizado ahora';
  if (status.lastSyncAt) {
    const diffSecs = Math.max(1, Math.floor((now - status.lastSyncAt) / 1000));
    if (diffSecs < 60) {
      relativeTimeLabel = `Sincronizado hace ${diffSecs} seg`;
    } else if (diffSecs < 3600) {
      relativeTimeLabel = `Sincronizado hace ${Math.floor(diffSecs / 60)} min`;
    } else {
      relativeTimeLabel = `Sincronizado a las ${new Date(status.lastSyncAt).toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit'
      })}`;
    }
  }

  return {
    ...status,
    relativeTimeLabel
  };
}

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

export async function pushSnapshotToSupabase(snapshot: BackupSnapshotRecord): Promise<boolean> {
  const client = getClient();
  if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    emitCloudStatus({
      state: 'offline_pending',
      detailMessage: 'Guardado en Local (Pendiente subir a nube)'
    });
    return false;
  }

  emitCloudStatus({
    state: 'syncing',
    detailMessage: 'Subiendo Snapshot a Supabase...'
  });

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

    const nowTs = Date.now();
    if (!error && typeof window !== 'undefined') {
      localStorage.setItem(LAST_SYNC_TS_KEY, String(nowTs));
    }

    emitCloudStatus({
      state: error ? 'offline_pending' : 'synced',
      lastSyncAt: error ? currentCloudStatus.lastSyncAt : nowTs,
      detailMessage: error ? 'Guardado en Local' : 'Sincronizado con Supabase'
    });

    return !error;
  } catch {
    emitCloudStatus({
      state: 'offline_pending',
      detailMessage: 'Guardado en Local (Pendiente subir a nube)'
    });
    return false;
  }
}

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
    emitCloudStatus({
      state: 'offline_pending',
      detailMessage: 'Guardado en Local (Pendiente subir a nube)'
    });
    return {
      ok: false,
      message: '⚡ Sin red móvil: Guardado en bóveda local IndexedDB.',
      syncedPackages: 0,
      syncedShifts: 0,
      syncedSnapshots: 0
    };
  }

  emitCloudStatus({
    state: 'syncing',
    detailMessage: 'Subiendo cambios a Supabase...'
  });

  try {
    const allPackages = (await db.packages.toArray()).filter((p) => !p.isTestData);
    const allShifts = await db.shifts.toArray();
    const allDeductions = await db.deductions.toArray();
    const allSettlements = await db.settlements.toArray();
    const allSnapshots = await db.backupSnapshots.toArray();

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

    const recentSnapshots = allSnapshots.slice(-15);
    for (const snap of recentSnapshots) {
      await pushSnapshotToSupabase(snap);
    }

    // Sincronizar patrones aprendidos del motor de etiquetas iMile (learned_patterns)
    try {
      const allPatterns = await db.learnedPatterns.toArray();
      if (allPatterns.length > 0) {
        const patternRows = allPatterns.map((lp) => ({
          recipient_phone: lp.recipientPhone,
          recipient_name: lp.recipientName,
          normalized_address: lp.normalizedAddress,
          neighborhood: lp.neighborhood || 'Medellín',
          sample_tracking_number: lp.sampleTrackingNumber || '',
          last_four_digits: lp.lastFourDigits || '',
          ocr_raw_snippet: lp.ocrRawSnippet || '',
          preferred_rotation_deg: lp.preferredRotationDeg ?? 0,
          to_block_relative_box: lp.toBlockRelativeBox || null,
          confirmations_count: lp.confirmationsCount || 1,
          updated_at: lp.updatedAt || Date.now(),
          synced_at: new Date().toISOString()
        }));
        await client
          .from('learned_patterns')
          .upsert(patternRows, { onConflict: 'recipient_phone' });
      }
    } catch {
      // No bloquear la sincronización principal si la tabla aún no ha sido creada en Supabase
    }

    const nowTs = Date.now();
    if (typeof window !== 'undefined') {
      localStorage.setItem(LAST_SYNC_TS_KEY, String(nowTs));
    }

    emitCloudStatus({
      state: 'synced',
      lastSyncAt: nowTs,
      detailMessage: 'Sincronizado con Supabase'
    });

    return {
      ok: true,
      message: `✅ Sincronizado con Supabase (${allPackages.length} paq., ${allShifts.length} jornadas, ${recentSnapshots.length} backups).`,
      syncedPackages: allPackages.length,
      syncedShifts: allShifts.length,
      syncedSnapshots: recentSnapshots.length
    };
  } catch (err) {
    emitCloudStatus({
      state: 'offline_pending',
      detailMessage: 'Guardado en Local (Pendiente subir a nube)'
    });
    return {
      ok: false,
      message:
        err instanceof Error
          ? `Guardado en Local (Aviso Cloud: ${err.message})`
          : 'Guardado en bóveda local IndexedDB (Pendiente sincronizar nube).',
      syncedPackages: 0,
      syncedShifts: 0,
      syncedSnapshots: 0
    };
  }
}
