import React, { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  DatabaseBackup,
  Download,
  Upload,
  Copy,
  Check,
  Trash2,
  PackagePlus,
  ShieldCheck,
  DollarSign,
  RefreshCw,
  FlaskConical,
  Cloud,
  CloudUpload,
  FolderOpen,
  RotateCcw,
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import {
  db,
  getDefaultPackageRate,
  updatePackageRateSetting,
  createBackupSnapshot,
  wipeOperationalDatabaseWithMandatoryBackup,
  restoreSessionFromSnapshot,
  downloadSnapshotAsJSONFile,
  saveSnapshotToDateFolderWithDirectoryPicker,
  type BackupSnapshotRecord,
} from '../db/database';
import { formatCOP } from '../utils/mediaAndFeedback';
import { formatLiveCOPInput, parseLiveCOPInput } from '../utils/formatters';
import { seedMedellinDemoBatch, clearStressTestPackages } from '../utils/demoSeeder';
import {
  getSupabaseConfig,
  saveSupabaseCredentials,
  resetToDefaultSupabaseCredentials,
  syncToSupabase,
  pushSnapshotToSupabase,
  useCloudSyncStatus,
} from '../services/supabaseSync';
import { useToast, useConfirm } from './ui/FeedbackSystem';

interface SettingsBackupViewProps {
  highContrastSun: boolean;
  onOpenTestLab: () => void;
}

export const SettingsBackupView: React.FC<SettingsBackupViewProps> = ({
  highContrastSun,
  onOpenTestLab,
}) => {
  const toast = useToast();
  const { confirm } = useConfirm();
  const cloudSync = useCloudSyncStatus();

  const [copied, setCopied] = useState<boolean>(false);
  const [rateInput, setRateInput] = useState<string>(() =>
    formatLiveCOPInput(String(getDefaultPackageRate()))
  );

  // Estado para crear Punto de Restauración manual
  const [customSessionName, setCustomSessionName] = useState<string>('');
  const [checkpointBtnState, setCheckpointBtnState] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [syncBtnState, setSyncBtnState] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [restoringSnapId, setRestoringSnapId] = useState<number | null>(null);
  const [expandedFolderDates, setExpandedFolderDates] = useState<Record<string, boolean>>({});

  // Estado Nube Supabase Preconfigurada (qsoekxdghdklwduwleuh)
  const initialSupa = getSupabaseConfig();
  const [supaUrl, setSupaUrl] = useState<string>(initialSupa.url);
  const [supaKey, setSupaKey] = useState<string>(initialSupa.anonKey);
  const [projectRef, setProjectRef] = useState<string>(initialSupa.projectRef);
  const [isConfiguredSupa, setIsConfiguredSupa] = useState<boolean>(initialSupa.isConfigured);
  const [showAdvancedCloud, setShowAdvancedCloud] = useState<boolean>(false);

  // Consultar todos los Snapshots guardados en la bóveda protegida `backupSnapshots`
  const allSnapshots =
    useLiveQuery(() => db.backupSnapshots.orderBy('timestamp').reverse().toArray(), []) || [];

  // Agrupar Snapshots por carpeta de fecha (`folderDate`: 'YYYY-MM-DD')
  const groupedFolders = useMemo(() => {
    const map = new Map<string, BackupSnapshotRecord[]>();
    for (const snap of allSnapshots) {
      const list = map.get(snap.folderDate) || [];
      list.push(snap);
      map.set(snap.folderDate, list);
    }
    return Array.from(map.entries()).sort(([dateA], [dateB]) => dateB.localeCompare(dateA));
  }, [allSnapshots]);

  useEffect(() => {
    const syncRate = () => setRateInput(formatLiveCOPInput(String(getDefaultPackageRate())));
    window.addEventListener('miruta-rate-updated', syncRate);
    return () => window.removeEventListener('miruta-rate-updated', syncRate);
  }, []);

  const handleSaveRate = async (recalculateCurrentShift: boolean) => {
    const parsed = parseLiveCOPInput(rateInput);
    if (parsed <= 0) {
      toast.error('⚠️ Ingresa una tarifa válida mayor a $0 COP');
      return;
    }

    if (parsed < 500 || parsed > 50000) {
      const accepted = await confirm({
        title: '¿Confirmar tarifa inusual?',
        description: `Estás configurando ${formatCOP(parsed)} COP por paquete entregado. El rango habitual está entre $500 y $50.000 COP.`,
        confirmLabel: 'Sí, aplicar tarifa',
        cancelLabel: 'Corregir valor',
        variant: 'warning',
      });
      if (!accepted) return;
    }

    await updatePackageRateSetting(parsed, recalculateCurrentShift);
    toast.success(
      `✅ Tarifa actualizada a ${formatCOP(parsed)} COP`,
      recalculateCurrentShift
        ? 'Se recalcularon los paquetes de la jornada actual.'
        : 'Aplica para todos los nuevos paquetes.'
    );
    syncToSupabase(true).catch(() => {});
  };

  // --- ACCIONES DE SNAPSHOTS Y BÓVEDA DE SESIONES POR FECHA ---
  const handleCreateManualCheckpoint = async () => {
    setCheckpointBtnState('loading');
    try {
      const nowFormatted = new Date().toLocaleString('es-CO', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
      const autoName = customSessionName.trim() || `Sesión Manual - ${nowFormatted}`;
      const snap = await createBackupSnapshot({
        sessionName: autoName,
        triggerType: 'manual_checkpoint',
        autoDownloadFile: false,
      });
      await pushSnapshotToSupabase(snap);
      setCustomSessionName('');
      setExpandedFolderDates((prev) => ({ ...prev, [snap.folderDate]: true }));
      setCheckpointBtnState('ready');
      toast.success(
        `📌 Punto de restauración guardado (${snap.stats.packagesCount} paquetes)`,
        `"${snap.sessionName}" en carpeta 📁 ${snap.folderDate}`
      );
      setTimeout(() => setCheckpointBtnState('idle'), 1500);
    } catch {
      setCheckpointBtnState('idle');
      toast.error('⚠️ Error al guardar punto de restauración');
    }
  };

  const handleRestoreSnapshotSession = async (snap: BackupSnapshotRecord) => {
    if (snap.id === undefined) return;
    const accepted = await confirm({
      title: `¿Restaurar "${snap.sessionName}"?`,
      description: `Se cargará la sesión del ${snap.folderDate} en tu vista operativa actual.`,
      details: [
        `Paquetes en esta sesión: ${snap.stats.packagesCount} (${snap.stats.deliveredCount} entregados)`,
        `Valor bruto registrado: ${formatCOP(snap.stats.totalGrossCOP, true)}`,
        'Se guardará automáticamente un respaldo previo de tu estado actual antes de restaurar.',
      ],
      confirmLabel: '🔄 Restaurar Sesión',
      cancelLabel: 'Cancelar',
      variant: 'info',
    });
    if (!accepted) return;

    setRestoringSnapId(snap.id);
    try {
      const restored = await restoreSessionFromSnapshot(snap.id);
      toast.success(
        `✅ Sesión "${restored.sessionName}" restaurada al 100%`,
        `${restored.stats.packagesCount} paquetes recuperados en tu ruta.`
      );
    } catch {
      toast.error('⚠️ No se pudo restaurar la sesión seleccionada');
    } finally {
      setTimeout(() => setRestoringSnapId(null), 1200);
    }
  };

  const handleDeleteSnapshot = async (snap: BackupSnapshotRecord) => {
    if (snap.id === undefined) return;
    const accepted = await confirm({
      title: '¿Eliminar Snapshot de la Bóveda?',
      description: `Se eliminará el punto de restauración "${snap.sessionName}" (${snap.folderDate}).`,
      confirmLabel: '🗑️ Sí, eliminar',
      cancelLabel: 'Conservar',
      variant: 'danger',
    });
    if (!accepted) return;

    await db.backupSnapshots.delete(snap.id);
    toast.info('🗑️ Snapshot eliminado de la bóveda');
  };

  // --- FLUJO OBLIGATORIO CON BARRA DE PROGRESO PASO A PASO: BORRAR BASE DE DATOS ---
  const handleWipeDatabaseWithMandatoryBackup = async () => {
    let createdSnap: BackupSnapshotRecord | null = null;

    const accepted = await confirm({
      title: '🛡️ Borrar Base Operativa con Auto-Backup',
      description:
        'Antes de limpiar las tablas operativas (paquetes, jornadas y quincenas), MiRuta ejecutará un protocolo de respaldo automático en 3 pasos:',
      details: [
        'La Bóveda de Sesiones (backupSnapshots) NO se borra.',
        'Se descargará automáticamente una copia .JSON en tu dispositivo.',
        'Podrás restaurar esta sesión cuando quieras con 1 toque.',
      ],
      steps: [
        'Paso 1/3: Generando Snapshot de seguridad...',
        'Paso 2/3: Subiendo respaldo a Supabase Cloud...',
        'Paso 3/3: Limpiando tablas operativas...',
      ],
      confirmLabel: '🛡️ Respaldar y Borrar Ahora',
      cancelLabel: 'Cancelar',
      variant: 'danger',
      onExecuteWithSteps: async (updateStep) => {
        // Paso 1
        updateStep(0, 'running');
        await new Promise((r) => setTimeout(r, 250));
        const mandatorySnapshot = await wipeOperationalDatabaseWithMandatoryBackup();
        createdSnap = mandatorySnapshot;
        updateStep(0, 'done');

        // Paso 2
        updateStep(1, 'running');
        await pushSnapshotToSupabase(mandatorySnapshot);
        updateStep(1, 'done');

        // Paso 3
        updateStep(2, 'running');
        await new Promise((r) => setTimeout(r, 250));
        updateStep(2, 'done');
      },
    });

    if (accepted && createdSnap) {
      const snap = createdSnap as BackupSnapshotRecord;
      setExpandedFolderDates((prev) => ({ ...prev, [snap.folderDate]: true }));
      toast.success(
        `✅ Auto-Backup creado en 📁 ${snap.folderDate}`,
        `${snap.stats.packagesCount} paquetes respaldados y base operativa limpia en cero.`
      );
    }
  };

  // --- SINCRONIZACIÓN CLOUD SUPABASE ---
  const handleManualCloudSync = async () => {
    setSyncBtnState('loading');
    const toastId = toast.loading('☁️ Sincronizando datos con Supabase...');
    const res = await syncToSupabase(false);
    if (res.ok) {
      setSyncBtnState('ready');
      toast.updateToast(toastId, {
        type: 'success',
        title: '✅ Sincronización con Supabase completada',
        description: res.message,
        duration: 3500,
      });
      setTimeout(() => setSyncBtnState('idle'), 1500);
    } else {
      setSyncBtnState('idle');
      toast.updateToast(toastId, {
        type: 'warning',
        title: '⚡ Guardado en bóveda local IndexedDB',
        description: res.message,
        duration: 4000,
      });
    }
  };

  const handleSaveCustomSupabaseConfig = async () => {
    saveSupabaseCredentials(supaUrl, supaKey);
    const updated = getSupabaseConfig();
    setIsConfiguredSupa(updated.isConfigured);
    setProjectRef(updated.projectRef);
    toast.success('🔐 Credenciales de Supabase actualizadas');
    await handleManualCloudSync();
  };

  const handleResetDefaultSupabase = () => {
    resetToDefaultSupabaseCredentials();
    const def = getSupabaseConfig();
    setSupaUrl(def.url);
    setSupaKey(def.anonKey);
    setProjectRef(def.projectRef);
    setIsConfiguredSupa(def.isConfigured);
    toast.info('🟢 Conexión predeterminada restaurada', `Proyecto: ${def.projectRef}`);
  };

  const handleExportManualJSON = async () => {
    const snap = await createBackupSnapshot({
      sessionName: `Exportación Manual JSON (${new Date().toLocaleTimeString('es-CO')})`,
      triggerType: 'manual_checkpoint',
      autoDownloadFile: false,
    });
    await saveSnapshotToDateFolderWithDirectoryPicker(snap);
    await pushSnapshotToSupabase(snap);
    toast.success(
      `✅ Backup guardado en carpeta 📁 ${snap.folderDate}`,
      `${snap.stats.packagesCount} paquetes exportados en formato .JSON`
    );
  };

  const handleImportJSONBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.packages)) {
        toast.error(
          '⚠️ Archivo inválido',
          'El archivo seleccionado no es un backup válido de MiRuta.'
        );
        return;
      }

      const now = new Date();
      const folderDate = parsed.folderDate || now.toISOString().slice(0, 10);
      const delivered = parsed.packages.filter(
        (p: { status?: string }) => p.status === 'delivered'
      );
      const totalGross = delivered.reduce(
        (s: number, p: { rate?: number }) => s + (p.rate || 2200),
        0
      );

      const importedSnap: BackupSnapshotRecord = {
        folderDate,
        timestamp: now.toISOString(),
        sessionName: parsed.sessionName || `Importado desde archivo (${file.name})`,
        triggerType: 'manual_checkpoint',
        stats: {
          packagesCount: parsed.packages.length,
          deliveredCount: delivered.length,
          shiftsCount: Array.isArray(parsed.shifts) ? parsed.shifts.length : 0,
          totalGrossCOP: totalGross,
        },
        payloadJSON: text,
      };

      const snapId = await db.backupSnapshots.add(importedSnap);
      await restoreSessionFromSnapshot(snapId);

      toast.success(
        `✅ Backup importado con éxito`,
        `${parsed.packages.length} paquetes recuperados en tu ruta.`
      );
    } catch {
      toast.error('⚠️ Error al leer o restaurar el archivo JSON');
    }
  };

  const handleCopySummaryToClipboard = async () => {
    const packages = await db.packages.toArray();
    const delivered = packages.filter((p) => p.status === 'delivered');
    const rate = getDefaultPackageRate();
    const totalCOP = delivered.reduce((acc, p) => acc + (p.rate || rate), 0);

    const lines = [
      `📦 RESUMEN MIRUTA BY CHRISTIAN ROMERO`,
      `Fecha: ${new Date().toLocaleString('es-CO')}`,
      `Total Entregados: ${delivered.length} paquetes`,
      `Total a Cobrar: ${formatCOP(totalCOP, true)}`,
      `----------------------------------------`,
      ...delivered.map(
        (p, idx) =>
          `${idx + 1}. Guía ${p.trackingNumber} (#${p.lastFourDigits}) | ${p.rawAddress} | ${
            p.deliveredAt ? new Date(p.deliveredAt).toLocaleString('es-CO') : 'Entregado'
          }`
      ),
    ];

    await navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    toast.success('📋 Resumen copiado al portapapeles', `${delivered.length} guías listas para pegar en WhatsApp`);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleSeedDemo = async () => {
    await seedMedellinDemoBatch();
    toast.success('✅ Lote de 6 paquetes demo cargado en Medellín');
  };

  const handleCleanOnlyTest = async () => {
    const removed = await clearStressTestPackages();
    toast.info(`🧹 ${removed} paquetes de prueba eliminados`);
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-2.5 space-y-3.5 pb-10">
      {/* 1. CONEXIÓN SUPABASE PRECONFIGURADA (qsoekxdghdklwduwleuh) */}
      <div
        className={`rounded-3xl border-2 p-4 shadow-xl space-y-3 ${
          highContrastSun
            ? 'bg-white border-emerald-600 text-slate-950'
            : 'bg-slate-900/95 border-emerald-500/50 text-slate-50'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-emerald-600 text-white shrink-0">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  {isConfiguredSupa
                    ? `🟢 Conectado a Supabase (${projectRef})`
                    : '⚡ Modo 100% Local'}
                </span>
                <span className="text-[10px] font-bold text-indigo-300 bg-indigo-500/15 border border-indigo-500/30 px-2 py-0.5 rounded-full">
                  ☁️ {cloudSync.relativeTimeLabel}
                </span>
              </div>
              <h2 className="text-sm sm:text-base font-black mt-1">
                Respaldo Cloud en Tiempo Real
              </h2>
              <p className="text-[11px] text-slate-400">
                Sincroniza paquetes, quincenas y bóveda de backups con tu nube Supabase
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={syncBtnState === 'loading'}
            onClick={handleManualCloudSync}
            className="flex-1 py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-75 text-white font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 active:scale-95 transition-all"
          >
            {syncBtnState === 'loading' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Sincronizando con Supabase...</span>
              </>
            ) : syncBtnState === 'ready' ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>✅ ¡Listo!</span>
              </>
            ) : (
              <>
                <CloudUpload className="w-4 h-4" />
                <span>☁️ SINCRONIZAR AHORA</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowAdvancedCloud((prev) => !prev)}
            className="px-3 py-3 rounded-2xl bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1"
          >
            <span>Config</span>
            {showAdvancedCloud ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {showAdvancedCloud && (
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase block mb-0.5">
                SUPABASE URL
              </label>
              <input
                type="url"
                value={supaUrl}
                onChange={(e) => setSupaUrl(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-700 text-white"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase block mb-0.5">
                SUPABASE PUBLISHABLE / ANON KEY
              </label>
              <input
                type="text"
                value={supaKey}
                onChange={(e) => setSupaKey(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-700 text-white"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveCustomSupabaseConfig}
                className="flex-1 py-2 rounded-xl bg-blue-600 text-white font-black text-xs"
              >
                Guardar Credenciales
              </button>
              <button
                type="button"
                onClick={handleResetDefaultSupabase}
                className="py-2 px-3 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
              >
                Usar Predeterminada
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. 🗂️ BÓVEDA DE BACKUPS POR FECHA Y GESTOR DE SESIONES */}
      <div
        className={`rounded-3xl border-2 p-4 shadow-xl space-y-3.5 ${
          highContrastSun
            ? 'bg-white border-blue-600 text-slate-950'
            : 'bg-slate-900/95 border-blue-500/60 text-slate-50'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-blue-600 text-white shrink-0">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black leading-tight">
                🗂️ Bóveda de Backups y Sesiones
              </h2>
              <p className="text-xs text-slate-400">
                Organizada por carpetas de fecha (YYYY-MM-DD) • Protegida contra borrados
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-400 font-black text-xs shrink-0">
            {allSnapshots.length} sesiones
          </span>
        </div>

        {/* Crear Punto de Restauración Manual en Cualquier Momento */}
        <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
          <label className="text-[10px] font-black uppercase text-amber-400 block">
            📌 CREAR PUNTO DE RESTAURACIÓN (GUARDAR SESIÓN ACTUAL)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={customSessionName}
              onChange={(e) => setCustomSessionName(e.target.value)}
              placeholder="Opcional: Ej. Corte Quincena 1 Nov (o vacío = automático)"
              className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold border ${
                highContrastSun
                  ? 'bg-white border-slate-300 text-slate-950'
                  : 'bg-slate-900 border-slate-700 text-white'
              }`}
            />
            <button
              type="button"
              disabled={checkpointBtnState !== 'idle'}
              onClick={handleCreateManualCheckpoint}
              className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-70 text-slate-950 font-black text-xs flex items-center gap-1.5 shrink-0 shadow-md active:scale-95 transition-all"
            >
              {checkpointBtnState === 'loading' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Guardando...</span>
                </>
              ) : checkpointBtnState === 'ready' ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>✅ ¡Listo!</span>
                </>
              ) : (
                <>
                  <BookmarkPlus className="w-4 h-4" />
                  <span>Guardar</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Explorador de Carpetas por Fecha (📁 YYYY-MM-DD) */}
        {groupedFolders.length === 0 ? (
          <div className="p-4 rounded-2xl bg-slate-950/50 border border-slate-800 text-center text-xs text-slate-400 font-semibold">
            Aún no hay sesiones guardadas en la bóveda. Pulsa &quot;Guardar&quot; arriba o cierra una jornada para crear tu primera carpeta por fecha.
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {groupedFolders.map(([folderDate, snaps]) => {
              const isOpen = expandedFolderDates[folderDate] ?? true;
              return (
                <div
                  key={folderDate}
                  className="rounded-2xl border border-slate-800 bg-slate-950/70 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedFolderDates((prev) => ({
                        ...prev,
                        [folderDate]: !isOpen,
                      }))
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-900/90 flex items-center justify-between text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">📁</span>
                      <span className="font-mono text-xs font-black text-amber-400">
                        {folderDate}
                      </span>
                      <span className="text-[11px] font-bold text-slate-400">
                        ({snaps.length} {snaps.length === 1 ? 'backup' : 'backups'})
                      </span>
                    </div>
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </button>

                  {isOpen && (
                    <div className="p-2.5 space-y-2 divide-y divide-slate-800/60">
                      {snaps.map((snap) => {
                        const timeStr = new Date(snap.timestamp).toLocaleTimeString('es-CO', {
                          hour: '2-digit',
                          minute: '2-digit',
                        });
                        const isRestoringThis = restoringSnapId === snap.id;
                        return (
                          <div key={snap.id ?? snap.timestamp} className="pt-2 first:pt-0 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span
                                    className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                                      snap.triggerType === 'pre_wipe_auto'
                                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                        : snap.triggerType === 'shift_close'
                                        ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                    }`}
                                  >
                                    {snap.triggerType === 'pre_wipe_auto'
                                      ? '🛡️ Auto Pre-Borrado'
                                      : snap.triggerType === 'shift_close'
                                      ? '🏁 Cierre Jornada'
                                      : '📌 Checkpoint'}
                                  </span>
                                  <span className="text-[11px] font-mono text-slate-400">
                                    {timeStr}
                                  </span>
                                </div>
                                <p className="text-xs font-black text-white mt-0.5 truncate">
                                  {snap.sessionName}
                                </p>
                                <p className="text-[11px] font-bold text-emerald-400">
                                  📦 {snap.stats.packagesCount} paq ({snap.stats.deliveredCount} entregados) •{' '}
                                  {formatCOP(snap.stats.totalGrossCOP)}
                                </p>
                              </div>
                            </div>

                            {/* 3 Botones de Acción por Snapshot */}
                            <div className="grid grid-cols-3 gap-1.5">
                              <button
                                type="button"
                                disabled={isRestoringThis}
                                onClick={() => handleRestoreSnapshotSession(snap)}
                                className="py-1.5 px-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[11px] flex items-center justify-center gap-1 active:scale-95 transition-all"
                              >
                                {isRestoringThis ? (
                                  <>
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    <span>Listo</span>
                                  </>
                                ) : (
                                  <>
                                    <RotateCcw className="w-3 h-3" />
                                    <span>Restaurar</span>
                                  </>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  downloadSnapshotAsJSONFile(snap);
                                  toast.info('📥 Descargando archivo .JSON', snap.sessionName);
                                }}
                                className="py-1.5 px-2 rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-300 font-black text-[11px] flex items-center justify-center gap-1 active:scale-95 transition-all"
                              >
                                <Download className="w-3 h-3" />
                                <span>.JSON</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteSnapshot(snap)}
                                className="py-1.5 px-2 rounded-xl bg-slate-800 hover:bg-rose-950 text-rose-400 font-bold text-[11px] flex items-center justify-center gap-1 active:scale-95 transition-all"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Eliminar</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Botón de Borrado Seguro con Auto-Backup Previo Obligatorio */}
        <div className="pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={handleWipeDatabaseWithMandatoryBackup}
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-rose-600/25 active:scale-95 transition-all"
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            <span>🗑️ BORRAR BASE DE DATOS OPERATIVA (CON AUTO-BACKUP SEGURO)</span>
          </button>
          <p className="text-[10px] text-center text-slate-400 mt-1">
            Genera automáticamente un backup en carpeta por fecha + descarga .JSON antes de limpiar.
          </p>
        </div>
      </div>

      {/* 3. LABORATORIO DE DIAGNÓSTICO Y TEST DE AGILIDAD */}
      <div
        className={`rounded-3xl border-2 p-4 shadow-xl space-y-3 ${
          highContrastSun
            ? 'bg-purple-50 border-purple-500 text-slate-950'
            : 'bg-gradient-to-br from-slate-900 via-purple-950/40 to-slate-900 border-purple-500/60 text-slate-50'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 rounded-2xl bg-purple-600 text-white">
            <FlaskConical className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-black">
              🧪 Laboratorio de Diagnóstico y Agilidad
            </h2>
            <p className="text-xs text-slate-400">
              Prueba guía real iMile (6103026696672), velocidad de cámara y test de 40 paquetes
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenTestLab}
          className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-purple-600/30 active:scale-[0.99]"
        >
          <FlaskConical className="w-4 h-4" />
          <span>ABRIR LABORATORIO DE PRUEBAS Y BENCHMARK</span>
        </button>
      </div>

      {/* 4. CONFIGURACIÓN DE TARIFA DINÁMICA POR PAQUETE */}
      <div
        className={`rounded-3xl border p-4 shadow-lg space-y-3 ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-950'
            : 'bg-slate-900/95 border-slate-800 text-slate-50'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 rounded-2xl bg-emerald-600 text-white">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-black">
              Tarifa por Paquete Entregado ($ COP)
            </h2>
            <p className="text-xs text-slate-400">
              Modifica el valor pagado por paquete en cualquier momento
            </p>
          </div>
        </div>

        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-black text-emerald-400">
            $
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={rateInput}
            onChange={(e) => setRateInput(formatLiveCOPInput(e.target.value))}
            className={`w-full rounded-xl pl-8 pr-3.5 py-2.5 text-base font-black font-mono border ${
              highContrastSun
                ? 'bg-slate-50 border-slate-300 text-slate-950'
                : 'bg-slate-950 border-slate-700 text-white'
            }`}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleSaveRate(false)}
            className="py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all"
          >
            <Check className="w-4 h-4" />
            <span>Solo Nuevos Paquetes</span>
          </button>
          <button
            type="button"
            onClick={() => handleSaveRate(true)}
            className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Recalcular Jornada Actual</span>
          </button>
        </div>
      </div>

      {/* 5. EXPORTACIÓN / IMPORTACIÓN DE ARCHIVO EXTERNO Y PORTAPAPELES */}
      <div
        className={`rounded-3xl border p-4 shadow-lg space-y-3.5 ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-950'
            : 'bg-slate-900/95 border-slate-800 text-slate-50'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 rounded-2xl bg-blue-600 text-white">
            <DatabaseBackup className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-black">
              Exportar / Importar Archivos Externos
            </h2>
            <p className="text-xs text-slate-400">
              Guarda en subcarpeta por fecha o comparte por portapapeles
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          <button
            type="button"
            onClick={handleExportManualJSON}
            className="w-full py-3.5 px-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25 active:scale-95 transition-all"
          >
            <Download className="w-4 h-4" />
            <span>EXPORTAR BACKUP EN CARPETA POR FECHA (.JSON)</span>
          </button>

          <label className="w-full py-3.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-black text-xs flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all">
            <Upload className="w-4 h-4 text-emerald-400" />
            <span>RESTAURAR / IMPORTAR ARCHIVO (.JSON)</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleImportJSONBackup}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={handleCopySummaryToClipboard}
            className="w-full py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 active:scale-95 transition-all"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>
              {copied
                ? '¡COPIADO AL PORTAPAPELES!'
                : 'COPIAR RESUMEN DE GUÍAS AL PORTAPAPELES (PARA WHATSAPP)'}
            </span>
          </button>
        </div>

        <div className="pt-3 border-t border-slate-800 space-y-2">
          <span className="text-[11px] font-bold text-slate-400 uppercase block">
            Herramientas Rápidas de Lotes Demo
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleSeedDemo}
              className="py-2.5 px-2 rounded-xl bg-slate-800 border border-slate-700 text-blue-400 font-extrabold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all"
            >
              <PackagePlus className="w-4 h-4" />
              <span>Cargar 6 Demo</span>
            </button>

            <button
              type="button"
              onClick={handleCleanOnlyTest}
              className="py-2.5 px-2 rounded-xl bg-amber-950/50 border border-amber-500/40 text-amber-300 font-extrabold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all"
            >
              <Trash2 className="w-4 h-4" />
              <span>Limpiar Lote Test</span>
            </button>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            <strong>MiRuta by Christian Romero (v4.0):</strong> Conectado a Supabase (`qsoekxdghdklwduwleuh`) con Bóveda de Backups por Fecha, Validaciones en Tiempo Real y Auto-Respaldo obligatorio pre-borrado.
          </span>
        </div>
      </div>
    </div>
  );
};
