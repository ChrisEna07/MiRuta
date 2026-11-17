import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  Sun,
  Moon,
  BookOpen,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Pencil,
  Check,
  X,
  Cloud,
  Loader2,
  Database,
  Package,
  Car,
} from 'lucide-react';
import { BIBLE_VERSES, type BibleVerse } from '../data/verses';
import { getDefaultPackageRate, updatePackageRateSetting } from '../db/database';
import { formatCOP } from '../utils/mediaAndFeedback';
import { formatLiveCOPInput, parseLiveCOPInput } from '../utils/formatters';
import { useCloudSyncStatus, syncToSupabase } from '../services/supabaseSync';
import { useToast, useConfirm } from './ui/FeedbackSystem';

interface DynamicHeaderProps {
  highContrastSun: boolean;
  onToggleContrast: () => void;
  workMode: 'delivery' | 'transport';
  onChangeWorkMode: (mode: 'delivery' | 'transport') => void;
}

export const DynamicHeader: React.FC<DynamicHeaderProps> = ({
  highContrastSun,
  onToggleContrast,
  workMode,
  onChangeWorkMode,
}) => {
  const toast = useToast();
  const { confirm } = useConfirm();
  const cloudSync = useCloudSyncStatus();

  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [greeting, setGreeting] = useState<string>('');
  const [verse, setVerse] = useState<BibleVerse>(() => {
    const dayOfYear = Math.floor(Date.now() / 86400000);
    return BIBLE_VERSES[dayOfYear % BIBLE_VERSES.length];
  });
  const [showVerse, setShowVerse] = useState<boolean>(true);

  // Estado de Tarifa Dinámica
  const [currentRate, setCurrentRate] = useState<number>(() => getDefaultPackageRate());
  const [showRateModal, setShowRateModal] = useState<boolean>(false);
  const [tempRateInput, setTempRateInput] = useState<string>(() =>
    formatLiveCOPInput(String(getDefaultPackageRate()))
  );

  useEffect(() => {
    const updateGreeting = () => {
      const hour = new Date().getHours();
      if (hour >= 5 && hour < 12) {
        setGreeting('¡Buenos días, Christian! Dios bendiga tu ruta hoy.');
      } else if (hour >= 12 && hour < 18) {
        setGreeting('¡Buenas tardes, Christian! Mantén el enfoque, cada entrega cuenta.');
      } else {
        setGreeting('¡Buenas noches, Christian! Excelente trabajo, a cerrar con bien.');
      }
    };
    updateGreeting();
    const timer = setInterval(updateGreeting, 60000);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleRateUpdated = () => setCurrentRate(getDefaultPackageRate());

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('miruta-rate-updated', handleRateUpdated);

    return () => {
      clearInterval(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('miruta-rate-updated', handleRateUpdated);
    };
  }, []);

  const randomizeVerse = () => {
    const candidates = BIBLE_VERSES.filter((v) => v.id !== verse.id);
    const random = candidates[Math.floor(Math.random() * candidates.length)] || BIBLE_VERSES[0];
    setVerse(random);
  };

  const handleApplyNewRate = async (recalculateCurrentShift: boolean) => {
    const parsed = parseLiveCOPInput(tempRateInput);
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
    setCurrentRate(getDefaultPackageRate());
    setShowRateModal(false);
    toast.success(
      `✅ Tarifa actualizada a ${formatCOP(parsed)} COP`,
      recalculateCurrentShift
        ? 'Se recalcularon los paquetes de la jornada actual.'
        : 'Aplica para los próximos paquetes escaneados.'
    );
    syncToSupabase(true).catch(() => {});
  };

  return (
    <>
      <header
        className={`border-b transition-colors ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-950'
            : 'bg-slate-900/95 border-slate-800 text-slate-50'
        } sticky top-0 z-30 backdrop-blur-md`}
      >
        <div className="max-w-lg mx-auto px-4 py-2.5">
          {/* Top Row: Brand MR + Live Network & Cloud Sync Status + Sun/Dark Mode */}
          <div className="flex items-start sm:items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-emerald-600 flex items-center justify-center text-white font-black text-sm shadow-md shadow-blue-600/30 shrink-0 border border-white/15">
                MR
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h1 className="font-black text-base tracking-tight leading-snug">
                    MiRuta
                  </h1>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-blue-600/20 text-blue-400 border border-blue-500/30 whitespace-normal break-words leading-snug">
                    by Christian Romero
                  </span>
                </div>

                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {workMode === 'delivery' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setTempRateInput(formatLiveCOPInput(String(currentRate)));
                        setShowRateModal(true);
                      }}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 transition-colors whitespace-normal break-words leading-snug cursor-pointer ${
                        highContrastSun
                          ? 'bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200'
                          : 'bg-slate-800/90 border-slate-700 text-emerald-300 hover:bg-slate-800'
                      }`}
                    >
                      <span>Tarifa {formatCOP(currentRate)}</span>
                      <Pencil className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                    </button>
                  ) : (
                    <div className="text-[10px] font-black px-2 py-0.5 rounded-md border flex items-center gap-1 bg-amber-500/20 border-amber-500/40 text-amber-300">
                      <Car className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                      <span>InDrive / Pasajeros</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Live Cloud Sync & Offline Status Pill */}
              <div
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1.5 border transition-colors whitespace-normal break-words leading-snug ${
                  cloudSync.state === 'syncing'
                    ? 'bg-indigo-950/90 border-indigo-500/50 text-indigo-300'
                    : !isOnline || cloudSync.state === 'offline_pending'
                    ? highContrastSun
                      ? 'bg-amber-100 border-amber-500 text-amber-900'
                      : 'bg-amber-950/90 border-amber-500/50 text-amber-300'
                    : highContrastSun
                    ? 'bg-emerald-100 border-emerald-500 text-emerald-900'
                    : 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
                }`}
              >
                {cloudSync.state === 'syncing' ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin text-indigo-400 shrink-0" />
                    <span>🔄 Subiendo a Supabase...</span>
                  </>
                ) : !isOnline || cloudSync.state === 'offline_pending' ? (
                  <>
                    <Database className="w-3 h-3 text-amber-400 shrink-0" />
                    <span>📦 Local (Pendiente nube)</span>
                  </>
                ) : (
                  <>
                    <Cloud className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span>☁️ {cloudSync.relativeTimeLabel}</span>
                  </>
                )}
              </div>

              {/* Sun / Dark Mode Toggle */}
              <button
                type="button"
                onClick={onToggleContrast}
                title={
                  highContrastSun
                    ? 'Cambiar a Modo Oscuro (Ahorro Batería)'
                    : 'Cambiar a Modo Alto Contraste Sol'
                }
                className={`p-2 rounded-xl border transition-transform active:scale-95 ${
                  highContrastSun
                    ? 'bg-slate-900 text-amber-300 border-slate-800'
                    : 'bg-slate-800 text-amber-400 border-slate-700'
                }`}
              >
                {highContrastSun ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Selector de Modo de Trabajo (Hotfix v11.0: Arquitectura Multi-Modo) */}
          <div
            className={`mt-2 flex items-center justify-between gap-1 p-1 rounded-2xl border transition-all ${
              highContrastSun
                ? 'bg-slate-100 border-slate-300'
                : 'bg-slate-950/70 border-slate-800'
            }`}
          >
            <button
              type="button"
              onClick={() => onChangeWorkMode('delivery')}
              className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                workMode === 'delivery'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-900/40 ring-1 ring-white/20 scale-[1.01]'
                  : highContrastSun
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>📦 Mensajería</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeWorkMode('transport')}
              className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                workMode === 'transport'
                  ? 'bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-slate-950 shadow-md shadow-amber-900/40 ring-1 ring-white/30 font-black scale-[1.01]'
                  : highContrastSun
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Car className="w-3.5 h-3.5" />
              <span>🚗 Transporte</span>
            </button>
          </div>

          {/* Dynamic Greeting */}
          <div className="mt-2 flex items-start justify-between gap-2">
            <p
              className={`min-w-0 flex-1 text-xs font-bold whitespace-normal break-words leading-snug ${
                highContrastSun ? 'text-blue-800' : 'text-blue-300'
              }`}
            >
              {greeting}
            </p>
            <button
              type="button"
              onClick={() => setShowVerse((prev) => !prev)}
              className={`text-[11px] font-semibold flex items-center gap-1 px-2 py-0.5 rounded-lg shrink-0 ${
                highContrastSun
                  ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <BookOpen className="w-3 h-3 text-amber-400" />
              <span>Palabra</span>
              {showVerse ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>

          {/* Daily Bible Verse Card */}
          {showVerse && (
            <div
              className={`mt-2 p-2.5 rounded-xl border transition-all ${
                highContrastSun
                  ? 'bg-amber-50/90 border-amber-300 text-slate-900'
                  : 'bg-gradient-to-r from-slate-800/90 via-slate-800/75 to-blue-950/60 border-slate-700/80 text-slate-100'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-400 whitespace-normal break-words leading-snug">
                      {verse.reference} • {verse.theme}
                    </span>
                  </div>
                  <p
                    className={`text-xs italic whitespace-normal break-words leading-snug ${
                      highContrastSun ? 'text-slate-800 font-medium' : 'text-slate-200'
                    }`}
                  >
                    “{verse.text}”
                  </p>
                </div>
                <button
                  type="button"
                  onClick={randomizeVerse}
                  title="Otro versículo de ánimo"
                  className={`p-2 rounded-lg border shrink-0 active:rotate-180 transition-transform ${
                    highContrastSun
                      ? 'bg-white border-amber-300 text-amber-800 hover:bg-amber-100'
                      : 'bg-slate-900/70 border-slate-700 text-amber-300 hover:bg-slate-900'
                  }`}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Modal Rápido para Modificar Tarifa por Paquete en Caliente */}
      {showRateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div
            className={`w-full max-w-md rounded-3xl border p-4 shadow-2xl space-y-3.5 ${
              highContrastSun
                ? 'bg-white border-slate-300 text-slate-950'
                : 'bg-slate-900 border-slate-800 text-slate-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black">
                Modificar Tarifa por Paquete ($ COP)
              </h3>
              <button
                type="button"
                onClick={() => setShowRateModal(false)}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 block mb-1">
                NUEVO VALOR POR PAQUETE ENTREGADO ($ COP)
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-black text-emerald-400">
                  $
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={tempRateInput}
                  onChange={(e) => setTempRateInput(formatLiveCOPInput(e.target.value))}
                  className={`w-full rounded-xl pl-8 pr-3.5 py-2.5 text-lg font-black font-mono border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    highContrastSun
                      ? 'bg-slate-50 border-slate-300 text-slate-950'
                      : 'bg-slate-950 border-slate-700 text-white'
                  }`}
                  placeholder="2.200"
                />
              </div>
              <div className="flex gap-1.5 mt-2">
                {[2000, 2200, 2500, 2800, 3000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTempRateInput(formatLiveCOPInput(String(preset)))}
                    className="flex-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700"
                  >
                    ${preset.toLocaleString('es-CO')}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              ¿Cómo deseas aplicar la nueva tarifa de{' '}
              <strong className="text-emerald-400">
                {formatCOP(parseLiveCOPInput(tempRateInput) || 2200)} COP
              </strong>
              ?
            </p>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handleApplyNewRate(false)}
                className="w-full py-3 px-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all"
              >
                <Check className="w-4 h-4" />
                <span>APLICAR SOLO A NUEVOS PAQUETES A PARTIR DE AHORA</span>
              </button>

              <button
                type="button"
                onClick={() => handleApplyNewRate(true)}
                className="w-full py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                <span>RECALCULAR TAMBIÉN LOS PAQUETES DE LA JORNADA ACTUAL</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
