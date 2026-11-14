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
  DollarSign
} from 'lucide-react';
import {
  db,
  type DeliveryPackage,
  type WorkShift,
  ensureShiftExists,
  getTodayShiftId,
  getDefaultPackageRate
} from '../db/database';
import { formatCOP } from '../utils/mediaAndFeedback';

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
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [now, setNow] = useState<number>(Date.now());
  const [fuelInput, setFuelInput] = useState<string>('');

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (shift) {
      setFuelInput(String(shift.fuelExpense ?? 12000));
    }
  }, [shift?.fuelExpense, shift?.id]);

  // Calcular tiempo real efectivo en ruta (en ms)
  const computeRawActiveMs = (): number => {
    if (!shift || !shift.startedAt) return 0;
    const totalElapsed = Math.max(0, now - shift.startedAt);
    const currentPauseElapsed =
      shift.isPaused && shift.lastPauseStartedAt
        ? Math.max(0, now - shift.lastPauseStartedAt)
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
  const deliveredPackages = packages.filter((p) => p.status === 'delivered');
  const deliveredCount = deliveredPackages.length;
  const grossToday = deliveredPackages.reduce((acc, p) => acc + (p.rate || defaultRate), 0);
  const fuelCost = shift?.fuelExpense ?? 12000;
  const otherCost = shift?.otherExpense ?? 0;
  const totalExpenses = fuelCost + otherCost;

  // Velocidad real de entrega (paq/hora) y minutos por paquete
  const packagesPerHour =
    deliveredCount > 0 && activeHours >= 5 / 60 ? deliveredCount / activeHours : 0;
  const avgMinutesPerPackage =
    deliveredCount > 0 && activeMinutes > 0 ? activeMinutes / deliveredCount : 0;
  const netProfitTotal = grossToday - totalExpenses;
  const netProfitPerHour =
    deliveredCount > 0 && activeHours >= 5 / 60 ? netProfitTotal / activeHours : 0;

  // Semáforo Diagnóstico Automatizado v2.0 (Corregido bug de 0.0 paq/h)
  const getSemaphoreConfig = () => {
    const isShiftWaitingOrPaused = !shift?.startedAt || shift.isPaused;

    // 1. Si no hay jornada iniciada, está en pausa o los paquetes/hora son 0 (sin entregas)
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

    // 2. Si ya hay entregas pero el cronómetro lleva menos de 5 minutos
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

    // 3. Solo mostrar 🟢 RITMO ÓPTIMO cuando realmente se supere el umbral (>= 7 paq/h o > $12.500 libres/h reales)
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

    // 4. Ritmo Ajustado
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

    // 5. Zona / Ritmo No Rentable
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
    if (!s.startedAt) {
      await db.shifts.update(s.id, {
        startedAt: Date.now(),
        isPaused: false,
        lastPauseStartedAt: null,
        accumulatedPausedMs: 0
      });
      return;
    }
    if (s.isPaused) {
      const pauseDelta = s.lastPauseStartedAt ? Date.now() - s.lastPauseStartedAt : 0;
      await db.shifts.update(s.id, {
        isPaused: false,
        lastPauseStartedAt: null,
        accumulatedPausedMs: (s.accumulatedPausedMs || 0) + pauseDelta
      });
    } else {
      await db.shifts.update(s.id, {
        isPaused: true,
        lastPauseStartedAt: Date.now()
      });
    }
  };

  const handleResetTimer = async () => {
    const s = await ensureShiftExists(shift?.id || getTodayShiftId());
    await db.shifts.update(s.id, {
      startedAt: null,
      isPaused: true,
      lastPauseStartedAt: null,
      accumulatedPausedMs: 0,
      manualActiveMinutesOffset: 0
    });
  };

  const handleFuelChange = async (val: string) => {
    setFuelInput(val);
    const num = parseInt(val.replace(/\D/g, ''), 10) || 0;
    const s = await ensureShiftExists(shift?.id || getTodayShiftId());
    await db.shifts.update(s.id, { fuelExpense: num });
  };

  return (
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
        {/* Top Summary Bar (Always Visible) */}
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
                      PAUSADO
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
                      title={!shift?.startedAt || shift?.isPaused ? 'Iniciar / Reanudar Jornada' : 'Pausar por Almuerzo/Descanso'}
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
                    type="number"
                    inputMode="numeric"
                    value={fuelInput}
                    onChange={(e) => handleFuelChange(e.target.value)}
                    className={`w-full rounded-lg px-2 py-1 text-sm font-black border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      highContrastSun
                        ? 'bg-white border-slate-300 text-slate-950'
                        : 'bg-slate-900 border-slate-700 text-white'
                    }`}
                    placeholder="12000"
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
          </div>
        )}
      </div>
    </section>
  );
};
