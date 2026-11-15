import React, { useState, useEffect } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Fuel,
  TrendingUp,
  Clock,
  ChevronDown,
  ChevronUp,
  Gauge,
  DollarSign,
  Flag,
  CheckCircle2,
  AlertTriangle,
  CalendarClock,
  X
} from 'lucide-react';
import {
  db,
  type DeliveryPackage,
  type WorkShift,
  type PendingPackagesAction,
  ensureShiftExists,
  getTodayShiftId,
  getDefaultPackageRate,
  closeActiveShift
} from '../db/database';
import { formatCOP } from '../utils/mediaAndFeedback';
import { formatLiveCOPInput, parseLiveCOPInput } from '../utils/formatters';
import { syncToSupabase } from '../services/supabaseSync';
import { useToast, useConfirm } from './ui/FeedbackSystem';

interface ProfitabilityMeterProps {
  packages: DeliveryPackage[];
  shift: WorkShift | undefined;
  highContrastSun: boolean;
}

export const ProfitabilityMeter: React.FC<ProfitabilityMeterProps> = ({
  packages,
  shift,
  highContrastSun
}) => {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [now, setNow] = useState<number>(Date.now());
  const [fuelInput, setFuelInput] = useState<string>('');

  // Estado del Modal de Cierre de Jornada ("🏁 Terminar Jornada")
  const [showCloseShiftModal, setShowCloseShiftModal] = useState<boolean>(false);
  const [closingFuelInput, setClosingFuelInput] = useState<string>('12.000');
  const [pendingAction, setPendingAction] = useState<PendingPackagesAction>('move_to_tomorrow');
  const [isClosing, setIsClosing] = useState<boolean>(false);
  const [closedSuccessBanner, setClosedSuccessBanner] = useState<string>('');

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (shift) {
      setFuelInput(formatLiveCOPInput(String(shift.fuelExpense ?? 12000)));
      setClosingFuelInput(formatLiveCOPInput(String(shift.fuelExpense ?? 12000)));
    }
  }, [shift?.fuelExpense, shift?.id]);

  // Calcular tiempo real efectivo en ruta (en ms)
  const computeRawActiveMs = (): number => {
    if (!shift) return 0;
    if (shift.status === 'closed' && shift.effectiveDurationMs) {
      return shift.effectiveDurationMs;
    }
    if (!shift.startedAt) return 0;
    const refEnd = shift.endTime || now;
    const totalElapsed = Math.max(0, refEnd - shift.startedAt);
    const currentPauseElapsed =
      shift.isPaused && shift.lastPauseStartedAt
        ? Math.max(0, refEnd - shift.lastPauseStartedAt)
        : 0;
    const effective =
      totalElapsed -
      (shift.accumulatedPausedMs || 0) -
      currentPauseElapsed +
      (shift.manualActiveMinutesOffset || 0) * 60000;
    return Math.max(0, effective);
  };

  const rawActiveMs = computeRawActiveMs();
  const activeHours = rawActiveMs / 3600000;
  const activeMinutes = Math.floor(rawActiveMs / 60000);
  const hoursPart = Math.floor(activeMinutes / 60);
  const minsPart = activeMinutes % 60;
  const secsPart = Math.floor((rawActiveMs % 60000) / 1000);

  const defaultRate = getDefaultPackageRate();
  // Incluir todos los paquetes de hoy (incluso archivados) para el consolidado del día,
  // y separar los no archivados para la cola activa
  const unarchivedPackages = packages.filter((p) => !p.archivedInHistory);
  const deliveredPackages = packages.filter((p) => p.status === 'delivered');
  const pendingActivePackages = unarchivedPackages.filter(
    (p) => p.status === 'pending' || p.status === 'in_progress'
  );
  const issueActivePackages = unarchivedPackages.filter((p) => p.status === 'issue');

  const deliveredCount = deliveredPackages.length;
  const grossToday = deliveredPackages.reduce((acc, p) => acc + (p.rate || defaultRate), 0);
  const fuelCost = shift?.fuelExpense ?? 12000;
  const otherCost = shift?.otherExpense ?? 0;
  const totalExpenses = fuelCost + otherCost;

  const packagesPerHour =
    deliveredCount > 0 && activeHours >= 5 / 60 ? deliveredCount / activeHours : 0;
  const avgMinutesPerPackage =
    deliveredCount > 0 && activeMinutes > 0 ? activeMinutes / deliveredCount : 0;
  const netProfitTotal = grossToday - totalExpenses;
  const netProfitPerHour =
    deliveredCount > 0 && activeHours >= 5 / 60 ? netProfitTotal / activeHours : 0;

  const getSemaphoreConfig = () => {
    if (shift?.status === 'closed') {
      return {
        level: 'closed',
        badge: '🏁 JORNADA CERRADA',
        badgeBg: 'bg-indigo-600 text-white border border-indigo-400',
        bgClass: highContrastSun
          ? 'bg-indigo-50 border-indigo-400 text-indigo-950'
          : 'bg-indigo-950/60 border-indigo-500/40 text-indigo-200',
        message: `Jornada finalizada a las ${
          shift.endTime ? new Date(shift.endTime).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : ''
        }. Entregas cerradas hoy: ${deliveredCount} paq. (${formatCOP(grossToday)} Bruto / ${formatCOP(
          netProfitTotal
        )} Neto).`
      };
    }

    const isShiftWaitingOrPaused = !shift?.startedAt || shift.isPaused;

    if (isShiftWaitingOrPaused || deliveredCount === 0) {
      return {
        level: 'waiting',
        badge: '⚪ EN ESPERA / JORNADA PAUSADA',
        badgeBg: 'bg-slate-700 text-slate-100 border border-slate-600',
        bgClass: highContrastSun
          ? 'bg-slate-100 border-slate-400 text-slate-900'
          : 'bg-slate-800/80 border-slate-700 text-slate-200',
        message:
          'Cronómetro en espera o sin entregas registradas aún. Pulsa Play ▶️ al arrancar la moto o marca tu primera entrega para activar el cálculo real.'
      };
    }

    if (rawActiveMs < 5 * 60000) {
      return {
        level: 'calculating',
        badge: '⚡ CALCULANDO RITMO...',
        badgeBg: 'bg-blue-600 text-white',
        bgClass: highContrastSun
          ? 'bg-blue-50 border-blue-400 text-blue-950'
          : 'bg-blue-950/60 border-blue-500/40 text-blue-200',
        message: `Llevas ${deliveredCount} entrega(s) en los primeros ${Math.max(
          1,
          activeMinutes
        )} min de ruta. Al cumplir 5 minutos activos se estabilizará tu promedio real por hora.`
      };
    }

    if (packagesPerHour >= 7 || netProfitPerHour > 12500) {
      return {
        level: 'green',
        badge: '🟢 RITMO ÓPTIMO',
        badgeBg: 'bg-emerald-600 text-white',
        bgClass: highContrastSun
          ? 'bg-emerald-100 border-emerald-600 text-emerald-950'
          : 'bg-emerald-950/60 border-emerald-500/50 text-emerald-200',
        message:
          '🔥 ¡Ritmo excelente! El sector es denso y estás entregando cada ~8 min o menos. A este paso la jornada es totalmente rentable.'
      };
    }

    if (
      (packagesPerHour >= 4.5 && packagesPerHour < 7) ||
      (netProfitPerHour >= 7500 && netProfitPerHour <= 12500) ||
      activeHours < 1
    ) {
      return {
        level: 'yellow',
        badge: '🟡 RITMO AJUSTADO',
        badgeBg: 'bg-amber-500 text-slate-950',
        bgClass: highContrastSun
          ? 'bg-amber-100 border-amber-600 text-amber-950'
          : 'bg-amber-950/60 border-amber-500/50 text-amber-200',
        message:
          '⚡ Cuidado con los tiempos muertos. Usa el botón de Pre-aviso por WhatsApp antes de moverte al siguiente punto para no perder tiempo en las puertas.'
      };
    }

    return {
      level: 'red',
      badge: '🔴 ZONA / RITMO NO RENTABLE',
      badgeBg: 'bg-rose-600 text-white',
      bgClass: highContrastSun
        ? 'bg-rose-100 border-rose-600 text-rose-950'
        : 'bg-rose-950/70 border-rose-500/60 text-rose-200',
      message: `🚨 Alerta de rentabilidad: Estás tardando más de 13 min por paquete. A ${formatCOP(
        defaultRate
      )} c/u, la gasolina y las lomas/distancias de este sector están comiéndose tu ganancia. Evalúa renegociar tarifa/sector con el Sr. Juan.`
    };
  };

  const semaphore = getSemaphoreConfig();

  const handleTogglePause = async () => {
    const s = await ensureShiftExists(shift?.id || getTodayShiftId());
    if (!s.startedAt || s.status === 'closed') {
      await db.shifts.update(s.id, {
        status: 'active',
        startedAt: s.startedAt || Date.now(),
        endTime: null,
        isPaused: false,
        lastPauseStartedAt: null
      });
      return;
    }
    if (s.isPaused) {
      const pauseDelta = s.lastPauseStartedAt ? Date.now() - s.lastPauseStartedAt : 0;
      await db.shifts.update(s.id, {
        status: 'active',
        isPaused: false,
        lastPauseStartedAt: null,
        accumulatedPausedMs: (s.accumulatedPausedMs || 0) + pauseDelta
      });
    } else {
      await db.shifts.update(s.id, {
        status: 'paused',
        isPaused: true,
        lastPauseStartedAt: Date.now()
      });
    }
  };

  const handleResetTimer = async () => {
    const accepted = await confirm({
      title: '¿Reiniciar el cronómetro de ruta?',
      description: 'Se pondrá el contador de tiempo de hoy nuevamente en 00:00:00 (tus paquetes entregados se conservan).',
      confirmLabel: '🔄 Reiniciar Cronómetro',
      cancelLabel: 'Cancelar',
      variant: 'warning',
    });
    if (!accepted) return;

    const s = await ensureShiftExists(shift?.id || getTodayShiftId());
    await db.shifts.update(s.id, {
      status: 'paused',
      startedAt: null,
      endTime: null,
      isPaused: true,
      lastPauseStartedAt: null,
      accumulatedPausedMs: 0,
      manualActiveMinutesOffset: 0,
      effectiveDurationMs: 0
    });
    toast.info('⏱️ Cronómetro de jornada reiniciado a 00:00:00');
  };

  const handleFuelChange = async (val: string) => {
    const formatted = formatLiveCOPInput(val);
    setFuelInput(formatted);
    const num = parseLiveCOPInput(formatted);
    const s = await ensureShiftExists(shift?.id || getTodayShiftId());
    await db.shifts.update(s.id, { fuelExpense: num });
  };

  const handleConfirmCloseShift = async () => {
    setIsClosing(true);
    try {
      const finalFuel = parseLiveCOPInput(closingFuelInput);
      const summary = await closeActiveShift({
        shiftId: shift?.id || getTodayShiftId(),
        fuelExpense: finalFuel,
        pendingAction,
        effectiveDurationMs: rawActiveMs
      });

      setShowCloseShiftModal(false);
      setClosedSuccessBanner(
        `🏁 Jornada cerrada con éxito: ${summary.deliveredCount} entregados (${formatCOP(
          summary.grossCOP
        )} Bruto / ${formatCOP(summary.netCOP)} Neto). Paquetes archivados en Trazabilidad.`
      );
      toast.success(
        `🏁 Jornada cerrada (${summary.deliveredCount} entregados)`,
        `Libre hoy: ${formatCOP(summary.netCOP)} • Respaldo automático guardado.`
      );
      setTimeout(() => setClosedSuccessBanner(''), 6000);

      // Disparar sincronización opcional con Supabase en segundo plano
      syncToSupabase(true);
    } finally {
      setIsClosing(false);
    }
  };

  const canCloseShift =
    Boolean(shift?.startedAt && shift.status !== 'closed') || unarchivedPackages.length > 0;

  return (
    <>
      <section
        className={`mx-auto max-w-lg px-4 pt-2.5 ${
          highContrastSun ? 'text-slate-950' : 'text-slate-100'
        }`}
      >
        <div
          className={`rounded-2xl border p-3.5 shadow-lg transition-all ${
            highContrastSun
              ? 'bg-white border-slate-300'
              : 'bg-slate-900/90 border-slate-800'
          }`}
        >
          {/* Top Summary Bar */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[11px] font-black px-2.5 py-1 rounded-lg ${semaphore.badgeBg}`}>
                {semaphore.badge}
              </span>
              <span className="text-xs font-bold">
                {packagesPerHour.toFixed(1)} paq/h
              </span>
              <span className={`text-xs font-extrabold ${netProfitTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                • Bruto: {formatCOP(grossToday)}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setCollapsed((prev) => !prev)}
              className={`p-1.5 rounded-xl border text-xs font-bold flex items-center gap-1 ${
                highContrastSun
                  ? 'bg-slate-100 border-slate-300 text-slate-800'
                  : 'bg-slate-800 border-slate-700 text-slate-300'
              }`}
            >
              <span>Rentabilidad</span>
              {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>

          {closedSuccessBanner && (
            <div className="mt-2.5 p-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/50 text-emerald-300 text-xs font-bold">
              {closedSuccessBanner}
            </div>
          )}

          {!collapsed && (
            <div className="mt-3 space-y-2.5">
              {/* KPI Grid */}
              <div className="grid grid-cols-2 gap-2.5">
                {/* Cronómetro de Ruta */}
                <div
                  className={`p-2.5 rounded-xl border ${
                    highContrastSun ? 'bg-slate-50 border-slate-300' : 'bg-slate-950/70 border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-blue-400" />
                      TIEMPO EN RUTA
                    </span>
                    {(!shift?.startedAt || shift?.isPaused) && (
                      <span className="text-[10px] px-1.5 py-0.2 bg-amber-500/20 text-amber-400 rounded font-extrabold">
                        {shift?.status === 'closed' ? 'CERRADO' : 'PAUSADO'}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-mono text-base sm:text-lg font-black tracking-tight">
                      {String(hoursPart).padStart(2, '0')}:{String(minsPart).padStart(2, '0')}:
                      {String(secsPart).padStart(2, '0')}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={handleTogglePause}
                        title={
                          !shift?.startedAt || shift?.isPaused
                            ? 'Iniciar / Reanudar Jornada'
                            : 'Pausar por Almuerzo/Descanso'
                        }
                        className={`p-1.5 rounded-lg font-bold text-xs ${
                          !shift?.startedAt || shift?.isPaused
                            ? 'bg-emerald-600 text-white'
                            : 'bg-amber-500 text-slate-950'
                        }`}
                      >
                        {!shift?.startedAt || shift?.isPaused ? (
                          <Play className="w-3.5 h-3.5" />
                        ) : (
                          <Pause className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={handleResetTimer}
                        title="Reiniciar cronómetro de jornada"
                        className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Ritmo / Velocidad */}
                <div
                  className={`p-2.5 rounded-xl border ${
                    highContrastSun ? 'bg-slate-50 border-slate-300' : 'bg-slate-950/70 border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400">
                    <Gauge className="w-3.5 h-3.5 text-emerald-400" />
                    VELOCIDAD ENTREGA
                  </div>
                  <div className="mt-1 flex items-baseline justify-between flex-wrap gap-1">
                    <span className="text-base sm:text-lg font-black">
                      {packagesPerHour.toFixed(1)}{' '}
                      <span className="text-xs font-semibold text-slate-400">paq/h</span>
                    </span>
                    <span className="text-[11px] font-bold text-blue-400">
                      {deliveredCount > 0
                        ? avgMinutesPerPackage > 0
                          ? `~${avgMinutesPerPackage.toFixed(1)} min/paq`
                          : `${deliveredCount} entregados`
                        : '0 entregas'}
                    </span>
                  </div>
                </div>

                {/* Gasolina del Día */}
                <div
                  className={`p-2.5 rounded-xl border ${
                    highContrastSun ? 'bg-slate-50 border-slate-300' : 'bg-slate-950/70 border-slate-800'
                  }`}
                >
                  <label className="flex items-center gap-1 text-[11px] font-bold text-slate-400">
                    <Fuel className="w-3.5 h-3.5 text-amber-400" />
                    GASOLINA HOY ($ COP)
                  </label>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-400">$</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fuelInput}
                      onChange={(e) => handleFuelChange(e.target.value)}
                      className={`w-full rounded-lg px-2 py-1 text-sm font-black font-mono border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        highContrastSun
                          ? 'bg-white border-slate-300 text-slate-950'
                          : 'bg-slate-900 border-slate-700 text-white'
                      }`}
                      placeholder="12.000"
                    />
                  </div>
                </div>

                {/* Utilidad Libre por Hora */}
                <div
                  className={`p-2.5 rounded-xl border ${
                    highContrastSun ? 'bg-slate-50 border-slate-300' : 'bg-slate-950/70 border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    LIBRE / HORA (NETO)
                  </div>
                  <div className="mt-1 flex flex-col">
                    <span className="text-base font-black text-emerald-400">
                      {formatCOP(netProfitPerHour)}/h
                    </span>
                    <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-0.5">
                      <DollarSign className="w-3 h-3" />
                      Neto hoy: {formatCOP(netProfitTotal)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Semáforo Diagnóstico Automatizado */}
              <div className={`p-2.5 rounded-xl border text-xs font-semibold leading-relaxed ${semaphore.bgClass}`}>
                {semaphore.message}
              </div>

              {/* Botón Formal: 🏁 Terminar Jornada */}
              {canCloseShift && (
                <button
                  type="button"
                  onClick={() => {
                    setClosingFuelInput(formatLiveCOPInput(String(shift?.fuelExpense ?? 12000)));
                    setShowCloseShiftModal(true);
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-700 hover:from-indigo-500 hover:to-blue-600 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md active:scale-[0.99] transition-transform"
                >
                  <Flag className="w-4 h-4 text-amber-300" />
                  <span>🏁 TERMINAR JORNADA Y ARCHIVAR ENTREGAS DEL DÍA</span>
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* MODAL DE CIERRE FORMAL DE JORNADA ("🏁 Terminar Jornada") */}
      {showCloseShiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div
            className={`w-full max-w-md rounded-3xl border p-5 shadow-2xl space-y-4 ${
              highContrastSun
                ? 'bg-white border-slate-300 text-slate-950'
                : 'bg-slate-900 border-slate-800 text-slate-50'
            }`}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-600 text-white">
                  <Flag className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black leading-tight">
                    🏁 Cierre Formal de Jornada
                  </h3>
                  <p className="text-xs text-slate-400">
                    Fecha: {shift?.date || getTodayShiftId()}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCloseShiftModal(false)}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Resumen de Horario y Tiempo Efectivo */}
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-[10px] font-bold text-slate-400 block">
                  HORA INICIO / FIN
                </span>
                <p className="font-mono font-black text-white mt-0.5">
                  {shift?.startedAt
                    ? new Date(shift.startedAt).toLocaleTimeString('es-CO', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })
                    : '--:--'}{' '}
                  →{' '}
                  {new Date().toLocaleTimeString('es-CO', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-[10px] font-bold text-slate-400 block">
                  TIEMPO EFECTIVO RUTA
                </span>
                <p className="font-mono font-black text-blue-400 mt-0.5">
                  {hoursPart}h {minsPart}m (sin pausas)
                </p>
              </div>
            </div>

            {/* Conteo de Paquetes del Día */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 rounded-xl bg-emerald-950/50 border border-emerald-500/40">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                <span className="block text-lg font-black text-emerald-400 mt-0.5">
                  {deliveredCount}
                </span>
                <span className="text-[10px] font-bold text-emerald-200 uppercase">
                  Entregados
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-amber-950/50 border border-amber-500/40">
                <CalendarClock className="w-4 h-4 text-amber-400 mx-auto" />
                <span className="block text-lg font-black text-amber-400 mt-0.5">
                  {pendingActivePackages.length}
                </span>
                <span className="text-[10px] font-bold text-amber-200 uppercase">
                  Pendientes
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-rose-950/50 border border-rose-500/40">
                <AlertTriangle className="w-4 h-4 text-rose-400 mx-auto" />
                <span className="block text-lg font-black text-rose-400 mt-0.5">
                  {issueActivePackages.length}
                </span>
                <span className="text-[10px] font-bold text-rose-200 uppercase">
                  Con Novedad
                </span>
              </div>
            </div>

            {/* Confirmar Gasto de Gasolina */}
            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1">
                CONFIRMAR GASTO DE GASOLINA DE HOY ($ COP)
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-black text-amber-400">
                  $
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={closingFuelInput}
                  onChange={(e) => setClosingFuelInput(formatLiveCOPInput(e.target.value))}
                  className="w-full rounded-xl pl-8 pr-3.5 py-2.5 text-base font-black font-mono bg-slate-950 border border-slate-700 text-white"
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-xs font-bold px-1">
                <span className="text-slate-400">
                  Producido Bruto: <strong className="text-white">{formatCOP(grossToday)}</strong>
                </span>
                <span className="text-emerald-400">
                  Libre Neto Hoy:{' '}
                  <strong>
                    {formatCOP(
                      grossToday - parseLiveCOPInput(closingFuelInput)
                    )}
                  </strong>
                </span>
              </div>
            </div>

            {/* Decisión sobre Paquetes Pendientes (si quedaron pendientes) */}
            {pendingActivePackages.length > 0 && (
              <div className="p-3 rounded-2xl bg-amber-950/50 border border-amber-500/50 space-y-2">
                <p className="text-xs font-black text-amber-300">
                  ⚠️ Tienes {pendingActivePackages.length} paquete(s) en estado pendiente:
                  <br />
                  <span className="font-normal text-amber-100">
                    ¿Pasar pendientes para mañana o marcarlos como devueltos a bodega?
                  </span>
                </p>

                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => setPendingAction('move_to_tomorrow')}
                    className={`w-full text-left p-2.5 rounded-xl text-xs font-bold border transition-all ${
                      pendingAction === 'move_to_tomorrow'
                        ? 'bg-blue-600 text-white border-blue-400'
                        : 'bg-slate-900 border-slate-700 text-slate-300'
                    }`}
                  >
                    📅 Pasar los {pendingActivePackages.length} pendientes para mañana (mantener en ruta)
                  </button>

                  <button
                    type="button"
                    onClick={() => setPendingAction('mark_returned_to_warehouse')}
                    className={`w-full text-left p-2.5 rounded-xl text-xs font-bold border transition-all ${
                      pendingAction === 'mark_returned_to_warehouse'
                        ? 'bg-rose-600 text-white border-rose-400'
                        : 'bg-slate-900 border-slate-700 text-slate-300'
                    }`}
                  >
                    🏢 Marcarlos como devueltos a bodega (Novedad al cierre)
                  </button>
                </div>
              </div>
            )}

            {/* Botones de Confirmación */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={isClosing}
                onClick={handleConfirmCloseShift}
                className="flex-1 py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-600 text-slate-950 font-black text-xs sm:text-sm shadow-lg"
              >
                {isClosing ? 'Cerrando Jornada...' : '✅ CONFIRMAR CIERRE DE JORNADA'}
              </button>
              <button
                type="button"
                onClick={() => setShowCloseShiftModal(false)}
                className="py-3.5 px-4 rounded-2xl bg-slate-800 text-slate-300 font-bold text-xs"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
