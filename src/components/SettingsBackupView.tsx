import React, { useState, useEffect } from 'react';
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
  CloudUpload
} from 'lucide-react';
import {
  db,
  getDefaultPackageRate,
  updatePackageRateSetting
} from '../db/database';
import { formatCOP } from '../utils/mediaAndFeedback';
import { seedMedellinDemoBatch, clearStressTestPackages } from '../utils/demoSeeder';
import {
  getSupabaseConfig,
  saveSupabaseCredentials,
  clearSupabaseCredentials,
  syncToSupabase
} from '../services/supabaseSync';

interface SettingsBackupViewProps {
  highContrastSun: boolean;
  onOpenTestLab: () => void;
}

export const SettingsBackupView: React.FC<SettingsBackupViewProps> = ({
  highContrastSun,
  onOpenTestLab
}) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [rateInput, setRateInput] = useState<string>(() => String(getDefaultPackageRate()));

  // Estado Nube Supabase Opcional
  const initialSupa = getSupabaseConfig();
  const [supaUrl, setSupaUrl] = useState<string>(initialSupa.url);
  const [supaKey, setSupaKey] = useState<string>(initialSupa.anonKey);
  const [isConfiguredSupa, setIsConfiguredSupa] = useState<boolean>(initialSupa.isConfigured);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(initialSupa.lastSyncAt);
  const [isSyncingCloud, setIsSyncingCloud] = useState<boolean>(false);

  useEffect(() => {
    const syncRate = () => setRateInput(String(getDefaultPackageRate()));
    window.addEventListener('miruta-rate-updated', syncRate);
    return () => window.removeEventListener('miruta-rate-updated', syncRate);
  }, []);

  const handleSaveRate = async (recalculateCurrentShift: boolean) => {
    const parsed = parseInt(rateInput.replace(/\D/g, ''), 10) || 2200;
    await updatePackageRateSetting(parsed, recalculateCurrentShift);
    setStatusMessage(
      recalculateCurrentShift
        ? `✅ Tarifa actualizada a ${formatCOP(parsed)} COP y recalculada en la jornada actual.`
        : `✅ Tarifa actualizada a ${formatCOP(parsed)} COP para todos los nuevos paquetes.`
    );
  };

  const handleSaveSupabaseConfig = async () => {
    saveSupabaseCredentials(supaUrl, supaKey);
    const updated = getSupabaseConfig();
    setIsConfiguredSupa(updated.isConfigured);
    if (updated.isConfigured) {
      setIsSyncingCloud(true);
      const res = await syncToSupabase(false);
      setIsSyncingCloud(false);
      setLastSyncAt(getSupabaseConfig().lastSyncAt);
      setStatusMessage(res.message);
    } else {
      setStatusMessage('Modo 100% Local activo (credenciales de Supabase vacías).');
    }
  };

  const handleManualCloudSync = async () => {
    setIsSyncingCloud(true);
    const res = await syncToSupabase(false);
    setIsSyncingCloud(false);
    setLastSyncAt(getSupabaseConfig().lastSyncAt);
    setStatusMessage(res.message);
  };

  const handleDisconnectSupabase = () => {
    clearSupabaseCredentials();
    setSupaUrl('');
    setSupaKey('');
    setIsConfiguredSupa(false);
    setStatusMessage('☁️ Desconectado de la nube. MiRuta opera en modo 100% Local.');
  };

  const handleExportJSONBackup = async () => {
    const packages = await db.packages.toArray();
    const shifts = await db.shifts.toArray();
    const deductions = await db.deductions.toArray();
    const settlements = await db.settlements.toArray();

    const payload = {
      app: 'MiRuta by Christian Romero',
      version: '3.0.0',
      exportedAt: new Date().toISOString(),
      defaultPackageRate: getDefaultPackageRate(),
      packages,
      shifts,
      deductions,
      settlements
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Backup_MiRuta_ChristianRomero_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMessage('✅ Archivo JSON de respaldo descargado en tu celular.');
  };

  const handleImportJSONBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.packages)) {
        alert('El archivo seleccionado no es un backup válido de MiRuta.');
        return;
      }

      await db.transaction(
        'rw',
        db.packages,
        db.shifts,
        db.deductions,
        db.settlements,
        async () => {
          if (Array.isArray(parsed.shifts)) {
            await db.shifts.bulkPut(parsed.shifts);
          }
          if (Array.isArray(parsed.deductions)) {
            await db.deductions.bulkPut(parsed.deductions);
          }
          if (Array.isArray(parsed.settlements)) {
            await db.settlements.bulkPut(parsed.settlements);
          }
          await db.packages.bulkPut(parsed.packages);
        }
      );

      if (parsed.defaultPackageRate) {
        await updatePackageRateSetting(Number(parsed.defaultPackageRate), false);
      }

      setStatusMessage(
        `✅ Respaldo restaurado con éxito (${parsed.packages.length} paquetes recuperados).`
      );
    } catch {
      alert('Error al leer o restaurar el archivo JSON.');
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
      )
    ];

    await navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setStatusMessage('✅ Resumen completo de guías copiado al portapapeles.');
    setTimeout(() => setCopied(false), 3000);
  };

  const handleSeedDemo = async () => {
    await seedMedellinDemoBatch();
    setStatusMessage('✅ Lote de prueba en Medellín cargado en la ruta de hoy.');
  };

  const handleCleanOnlyTest = async () => {
    const removed = await clearStressTestPackages();
    setStatusMessage(`🧹 ${removed} paquetes de prueba eliminados.`);
  };

  const handleClearAllData = async () => {
    if (
      window.confirm(
        '⚠️ ¿Estás seguro de borrar todos los datos locales? Te recomendamos exportar un Backup JSON primero.'
      )
    ) {
      await db.packages.clear();
      await db.shifts.clear();
      await db.deductions.clear();
      await db.settlements.clear();
      setStatusMessage('Base de datos local reiniciada.');
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-2.5 space-y-3.5 pb-10">
      {statusMessage && (
        <div className="p-3 rounded-2xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold">
          {statusMessage}
        </div>
      )}

      {/* ACCESO DESTACADO: 🧪 LABORATORIO DE DIAGNÓSTICO Y TEST DE AGILIDAD */}
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

      {/* Configuración de Tarifa Dinámica por Paquete */}
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
              Tarifa por Paquete Entregado
            </h2>
            <p className="text-xs text-slate-400">
              Modifica el valor pagado por paquete en cualquier momento
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
            className={`w-full rounded-xl px-3.5 py-2.5 text-base font-black font-mono border ${
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
            className="py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs flex items-center justify-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>Solo Nuevos Paquetes</span>
          </button>
          <button
            type="button"
            onClick={() => handleSaveRate(true)}
            className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center justify-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Recalcular Jornada Actual</span>
          </button>
        </div>
      </div>

      {/* NUBE SUPABASE OPCIONAL (100% LOCAL-FIRST) */}
      <div
        className={`rounded-3xl border p-4 shadow-lg space-y-3 ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-950'
            : 'bg-slate-900/95 border-slate-800 text-slate-50'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-sky-600 text-white">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black">
                Nube Supabase (Opcional)
              </h2>
              <p className="text-xs text-slate-400">
                IndexedDB es siempre el motor principal (0ms). Supabase respalda en segundo plano.
              </p>
            </div>
          </div>

          <span
            className={`px-2.5 py-1 rounded-full text-[10px] font-black ${
              isConfiguredSupa
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
          >
            {isConfiguredSupa ? '☁️ Nube Activa' : '⚡ 100% Local'}
          </span>
        </div>

        <div className="space-y-2">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-0.5">
              SUPABASE PROJECT URL (VITE_SUPABASE_URL)
            </label>
            <input
              type="url"
              value={supaUrl}
              onChange={(e) => setSupaUrl(e.target.value)}
              placeholder="https://xxxx.supabase.co"
              className={`w-full rounded-xl px-3 py-2 text-xs font-mono border ${
                highContrastSun
                  ? 'bg-slate-50 border-slate-300 text-slate-950'
                  : 'bg-slate-950 border-slate-700 text-white'
              }`}
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-0.5">
              SUPABASE ANON PUBLIC KEY (VITE_SUPABASE_ANON_KEY)
            </label>
            <input
              type="password"
              value={supaKey}
              onChange={(e) => setSupaKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
              className={`w-full rounded-xl px-3 py-2 text-xs font-mono border ${
                highContrastSun
                  ? 'bg-slate-50 border-slate-300 text-slate-950'
                  : 'bg-slate-950 border-slate-700 text-white'
              }`}
            />
          </div>
        </div>

        {lastSyncAt && (
          <p className="text-[11px] text-emerald-400 font-semibold">
            Última sincronización Cloud: {new Date(lastSyncAt).toLocaleString('es-CO')}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isSyncingCloud}
            onClick={handleSaveSupabaseConfig}
            className="flex-1 py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-black text-xs flex items-center justify-center gap-1.5"
          >
            <CloudUpload className="w-4 h-4" />
            <span>{isSyncingCloud ? 'Sincronizando...' : 'Guardar y Sincronizar Nube'}</span>
          </button>

          {isConfiguredSupa && (
            <>
              <button
                type="button"
                disabled={isSyncingCloud}
                onClick={handleManualCloudSync}
                className="py-2.5 px-3 rounded-xl bg-emerald-600 text-white font-black text-xs"
              >
                🔄 Sync Ahora
              </button>
              <button
                type="button"
                onClick={handleDisconnectSupabase}
                className="py-2.5 px-3 rounded-xl bg-slate-800 text-rose-400 font-bold text-xs"
              >
                Desconectar
              </button>
            </>
          )}
        </div>
      </div>

      {/* Blindaje y Backup Rápido IndexedDB */}
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
              Blindaje y Backup Rápido (IndexedDB)
            </h2>
            <p className="text-xs text-slate-400">
              Protege tus cuentas quincenales y auditorías contra borrado de caché
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          <button
            type="button"
            onClick={handleExportJSONBackup}
            className="w-full py-3.5 px-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25 active:scale-95"
          >
            <Download className="w-4 h-4" />
            <span>EXPORTAR BACKUP COMPLETO (.JSON)</span>
          </button>

          <label className="w-full py-3.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-black text-xs flex items-center justify-center gap-2 cursor-pointer active:scale-95">
            <Upload className="w-4 h-4 text-emerald-400" />
            <span>RESTAURAR / IMPORTAR BACKUP (.JSON)</span>
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
            className="w-full py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 active:scale-95"
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
            Herramientas de Ruta y Datos
          </span>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={handleSeedDemo}
              className="py-2.5 px-2 rounded-xl bg-slate-800 border border-slate-700 text-blue-400 font-extrabold text-[11px] flex items-center justify-center gap-1"
            >
              <PackagePlus className="w-3.5 h-3.5" />
              <span>Lote 6 Demo</span>
            </button>

            <button
              type="button"
              onClick={handleCleanOnlyTest}
              className="py-2.5 px-2 rounded-xl bg-amber-950/50 border border-amber-500/40 text-amber-300 font-extrabold text-[11px] flex items-center justify-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Borrar Test</span>
            </button>

            <button
              type="button"
              onClick={handleClearAllData}
              className="py-2.5 px-2 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-300 font-extrabold text-[11px] flex items-center justify-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Reset Total</span>
            </button>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            <strong>MiRuta by Christian Romero (v3.0):</strong> Plataforma inteligente de enrutamiento, trazabilidad probatoria con GPS y auditoría quincenal 100% Offline-First + Cloud Sync opcional.
          </span>
        </div>
      </div>
    </div>
  );
};
