import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Car,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  Calendar,
  Fuel,
  Coffee,
  Wrench,
  Percent,
  Award,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  FileSpreadsheet,
} from 'lucide-react';
import {
  db,
  getTodayShiftId,
  type WorkShift,
  type TransportTransaction,
  type TransportExpenseCategory,
} from '../db/database';
import { formatCOP } from '../utils/mediaAndFeedback';
import { useToast } from './ui/FeedbackSystem';

interface TransportFinancesViewProps {
  highContrastSun: boolean;
}

type PeriodFilterMode = 'current_q' | 'previous_q' | 'current_month' | 'all';

export const TransportFinancesView: React.FC<TransportFinancesViewProps> = ({
  highContrastSun,
}) => {
  const toast = useToast();
  const todayShiftId = getTodayShiftId();
  const now = new Date();

  // Estados de Filtro de Período
  const [filterMode, setFilterMode] = useState<PeriodFilterMode>('current_month');
  const [selectedMonth, setSelectedMonth] = useState<string>(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  );
  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null);
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);

  // Consulta en tiempo real de todos los turnos
  const allShifts = useLiveQuery(() => db.shifts.toArray(), []) || [];

  // Filtrado de turnos que corresponden al modo transporte
  const transportShifts = useMemo(() => {
    return allShifts.filter((s) => {
      const hasTransactions = Array.isArray(s.transactions) && s.transactions.length > 0;
      const hasTargetGoal = s.targetGoal !== undefined && s.targetGoal > 0;
      const isTodayActive = s.id === todayShiftId;
      return hasTransactions || hasTargetGoal || (isTodayActive && (s.transactions || []).length > 0);
    });
  }, [allShifts, todayShiftId]);

  // Rango de fechas según el filtro seleccionado
  const { startDateStr, endDateStr, periodTitle } = useMemo(() => {
    const [yearStr, monthStr] = selectedMonth.split('-');
    const year = parseInt(yearStr, 10) || now.getFullYear();
    const month = parseInt(monthStr, 10) || now.getMonth() + 1;
    const lastDayOfMonth = new Date(year, month, 0).getDate();
    const monthName = new Date(year, month - 1, 1).toLocaleString('es-CO', { month: 'long' });
    const capMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    if (filterMode === 'current_q') {
      const isFirstHalf = now.getDate() <= 15;
      if (isFirstHalf) {
        return {
          startDateStr: `${selectedMonth}-01`,
          endDateStr: `${selectedMonth}-15`,
          periodTitle: `1ª Quincena (01 - 15 ${capMonth} ${year})`,
        };
      } else {
        return {
          startDateStr: `${selectedMonth}-16`,
          endDateStr: `${selectedMonth}-${String(lastDayOfMonth).padStart(2, '0')}`,
          periodTitle: `2ª Quincena (16 - ${lastDayOfMonth} ${capMonth} ${year})`,
        };
      }
    }

    if (filterMode === 'previous_q') {
      const isFirstHalf = now.getDate() <= 15;
      if (isFirstHalf) {
        // La quincena anterior fue la 2da del mes pasado
        const prevMonthDate = new Date(year, month - 2, 1);
        const prevYear = prevMonthDate.getFullYear();
        const prevMonthNum = prevMonthDate.getMonth() + 1;
        const prevLastDay = new Date(prevYear, prevMonthNum, 0).getDate();
        const prevMonthStr = `${prevYear}-${String(prevMonthNum).padStart(2, '0')}`;
        const prevCapMonth = prevMonthDate.toLocaleString('es-CO', { month: 'long' });
        return {
          startDateStr: `${prevMonthStr}-16`,
          endDateStr: `${prevMonthStr}-${String(prevLastDay).padStart(2, '0')}`,
          periodTitle: `Quincena Anterior (16 - ${prevLastDay} ${prevCapMonth})`,
        };
      } else {
        return {
          startDateStr: `${selectedMonth}-01`,
          endDateStr: `${selectedMonth}-15`,
          periodTitle: `1ª Quincena (01 - 15 ${capMonth} ${year})`,
        };
      }
    }

    if (filterMode === 'current_month') {
      return {
        startDateStr: `${selectedMonth}-01`,
        endDateStr: `${selectedMonth}-${String(lastDayOfMonth).padStart(2, '0')}`,
        periodTitle: `Mes Completo (${capMonth} ${year})`,
      };
    }

    return {
      startDateStr: '2020-01-01',
      endDateStr: '2030-12-31',
      periodTitle: 'Todo el Historial de Conducción',
    };
  }, [filterMode, selectedMonth, now]);

  // Turnos dentro del rango seleccionado
  const filteredShifts = useMemo(() => {
    return transportShifts
      .filter((s) => {
        const shiftDate = s.date || s.id;
        return shiftDate >= startDateStr && shiftDate <= endDateStr;
      })
      .sort((a, b) => {
        const dateA = a.date || a.id;
        const dateB = b.date || b.id;
        return dateB.localeCompare(dateA);
      });
  }, [transportShifts, startDateStr, endDateStr]);

  // Consolidado de todas las transacciones del período
  const periodTransactions: TransportTransaction[] = useMemo(() => {
    return filteredShifts.flatMap((s) => s.transactions || []);
  }, [filteredShifts]);

  // Cálculos Financieros
  const incomeTransactions = useMemo(
    () => periodTransactions.filter((t) => t.type === 'income'),
    [periodTransactions]
  );
  const expenseTransactions = useMemo(
    () => periodTransactions.filter((t) => t.type === 'expense'),
    [periodTransactions]
  );

  const totalIncome = useMemo(
    () => incomeTransactions.reduce((acc, t) => acc + t.amount, 0),
    [incomeTransactions]
  );
  const totalExpense = useMemo(
    () => expenseTransactions.reduce((acc, t) => acc + t.amount, 0),
    [expenseTransactions]
  );
  const netProfit = totalIncome - totalExpense;
  const tripsCount = incomeTransactions.length;
  const avgTripIncome = tripsCount > 0 ? Math.round(totalIncome / tripsCount) : 0;
  const profitMarginPercent = totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(1) : '0';

  // Desglose de Gastos por Categoría
  const expensesByCategory = useMemo(() => {
    const cats: Record<TransportExpenseCategory, { label: string; amount: number; icon: string }> = {
      gasolina: { label: 'Gasolina', amount: 0, icon: '⛽' },
      comision_app: { label: 'Comisión App', amount: 0, icon: '📱' },
      comida: { label: 'Comida / Refrigerio', amount: 0, icon: '🍔' },
      pinchazo: { label: 'Pinchazo / Mecánica', amount: 0, icon: '🔧' },
      otro: { label: 'Otros Gastos', amount: 0, icon: '📝' },
    };

    for (const exp of expenseTransactions) {
      const catKey: TransportExpenseCategory = exp.category && cats[exp.category as TransportExpenseCategory]
        ? (exp.category as TransportExpenseCategory)
        : 'otro';
      cats[catKey].amount += exp.amount;
    }

    return Object.entries(cats).map(([key, data]) => ({
      key: key as TransportExpenseCategory,
      ...data,
      percent: totalExpense > 0 ? Math.round((data.amount / totalExpense) * 100) : 0,
    }));
  }, [expenseTransactions, totalExpense]);

  // Horas Conectadas Acumuladas
  const totalDrivingHours = useMemo(() => {
    let totalMs = 0;
    for (const s of filteredShifts) {
      if (s.id === todayShiftId && s.status === 'active' && s.startedAt) {
        totalMs += Math.max(0, Date.now() - s.startedAt - (s.accumulatedPausedMs || 0));
      } else {
        totalMs += s.effectiveDurationMs || 0;
      }
    }
    return totalMs / 3600000;
  }, [filteredShifts, todayShiftId]);

  const netPerHour =
    totalDrivingHours >= 0.05 ? Math.round(netProfit / totalDrivingHours) : 0;

  // Copiar Resumen Financiero Ejecutivo al Portapapeles
  const handleCopySummary = async () => {
    const lines = [
      `🚗 BALANCE FINANCIERO DE CONDUCCIÓN`,
      `Operador: Christian Romero`,
      `Período: ${periodTitle}`,
      `----------------------------------------`,
      `🏁 Carreras Realizadas: ${tripsCount} viajes`,
      `⏱️ Horas Conectado: ${totalDrivingHours.toFixed(1)} horas`,
      `💵 Ingresos Brutos: ${formatCOP(totalIncome, true)}`,
      `⛽ Gastos Operativos: ${formatCOP(totalExpense, true)}`,
      `----------------------------------------`,
      `💎 GANANCIA NETA LIBRE: ${formatCOP(netProfit, true)}`,
      `⚡ Promedio por Hora: ${formatCOP(netPerHour, true)}/h`,
      `📊 Promedio por Carrera: ${formatCOP(avgTripIncome, true)}`,
      `----------------------------------------`,
      `Desglose de Gastos:`,
      ...expensesByCategory
        .filter((c) => c.amount > 0)
        .map((c) => `  ${c.icon} ${c.label}: ${formatCOP(c.amount)} (${c.percent}%)`),
      `\nGenerado con MiRuta Conducción`,
    ];

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedSummary(true);
      toast.success('📋 Resumen Copiado al Portapapeles', 'Listo para enviar por WhatsApp o archivar.');
      setTimeout(() => setCopiedSummary(false), 3000);
    } catch {
      toast.error('No se pudo copiar al portapapeles');
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 space-y-4 pb-20">
      {/* 1. CABECERA Y SELECTOR DE PERÍODO */}
      <div
        className={`p-3.5 rounded-2xl border transition-all ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-900 shadow-sm'
            : 'bg-slate-900/95 border-slate-800 text-white shadow-md'
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
              <Car className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-black text-sm text-white">Finanzas de Conducción</h2>
              <p className="text-[11px] text-amber-400 font-bold">InDrive • Picap • Pasajeros</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCopySummary}
            className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer"
          >
            {copiedSummary ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">¡Copiado!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Copiar</span>
              </>
            )}
          </button>
        </div>

        {/* Chips de Selección de Período */}
        <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-slate-950/70 border border-slate-800 text-center">
          {[
            { id: 'current_q', label: 'Esta Quincena' },
            { id: 'previous_q', label: 'Quincena Ant.' },
            { id: 'current_month', label: 'Mes' },
            { id: 'all', label: 'Historial' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterMode(tab.id as PeriodFilterMode)}
              className={`py-1 px-1 rounded-lg text-[10px] sm:text-xs font-bold transition-all cursor-pointer ${
                filterMode === tab.id
                  ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Subtítulo del Período Actual */}
        <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400">
          <span className="font-bold text-slate-300">{periodTitle}</span>
          <span>{filteredShifts.length} jornadas en rango</span>
        </div>
      </div>

      {/* 2. HERO CARD: GANANCIA NETA LIBRE */}
      <div
        className={`p-4 rounded-3xl border transition-all ${
          netProfit >= 0
            ? highContrastSun
              ? 'bg-emerald-50 border-emerald-300 text-slate-900 shadow-md'
              : 'bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/50 border-emerald-500/40 text-white shadow-xl'
            : highContrastSun
            ? 'bg-rose-50 border-rose-300 text-slate-900 shadow-md'
            : 'bg-gradient-to-br from-slate-900 via-slate-900 to-rose-950/50 border-rose-500/40 text-white shadow-xl'
        }`}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
            <DollarSign className="w-4 h-4" />
            <span>Ganancia Neta Libre (Bolsillo)</span>
          </span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            Margen {profitMarginPercent}%
          </span>
        </div>

        <div className="mt-2 mb-3">
          <p
            className={`font-mono text-3xl sm:text-4xl font-black tracking-tight ${
              netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {formatCOP(netProfit)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5 font-medium">
            Dinero real descontando combustible, comisión InDrive y gastos de calle.
          </p>
        </div>

        {/* Indicadores de Rendimiento Rápido */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400">Promedio Horario</p>
              <p className="text-xs font-black text-amber-300">{formatCOP(netPerHour)}/h</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400 shrink-0">
              <Award className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400">Promedio / Carrera</p>
              <p className="text-xs font-black text-blue-300">{formatCOP(avgTripIncome)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 3. DESGLOSE DE CAJA PRINCIPAL (3 TARJETAS) */}
      <div className="grid grid-cols-3 gap-2">
        {/* Ingresos */}
        <div
          className={`p-3 rounded-2xl border text-center transition-all ${
            highContrastSun
              ? 'bg-white border-slate-300 text-slate-900 shadow-sm'
              : 'bg-slate-900/95 border-emerald-500/30 text-white'
          }`}
        >
          <div className="flex items-center justify-center gap-1 text-[10px] font-black uppercase text-emerald-400">
            <TrendingUp className="w-3 h-3" />
            <span>Ingresos</span>
          </div>
          <p className="text-sm sm:text-base font-black mt-1 text-emerald-400 tracking-tight">
            {formatCOP(totalIncome)}
          </p>
          <span className="text-[10px] text-slate-400 font-bold">{tripsCount} viajes</span>
        </div>

        {/* Gastos */}
        <div
          className={`p-3 rounded-2xl border text-center transition-all ${
            highContrastSun
              ? 'bg-white border-slate-300 text-slate-900 shadow-sm'
              : 'bg-slate-900/95 border-rose-500/30 text-white'
          }`}
        >
          <div className="flex items-center justify-center gap-1 text-[10px] font-black uppercase text-rose-400">
            <TrendingDown className="w-3 h-3" />
            <span>Gastos</span>
          </div>
          <p className="text-sm sm:text-base font-black mt-1 text-rose-400 tracking-tight">
            {formatCOP(totalExpense)}
          </p>
          <span className="text-[10px] text-slate-400 font-bold">
            {expenseTransactions.length} salidas
          </span>
        </div>

        {/* Horas */}
        <div
          className={`p-3 rounded-2xl border text-center transition-all ${
            highContrastSun
              ? 'bg-white border-slate-300 text-slate-900 shadow-sm'
              : 'bg-slate-900/95 border-blue-500/30 text-white'
          }`}
        >
          <div className="flex items-center justify-center gap-1 text-[10px] font-black uppercase text-blue-400">
            <Clock className="w-3 h-3" />
            <span>Tiempo</span>
          </div>
          <p className="text-sm sm:text-base font-black mt-1 text-blue-300 tracking-tight">
            {totalDrivingHours.toFixed(1)} h
          </p>
          <span className="text-[10px] text-slate-400 font-bold">
            {filteredShifts.length} jornadas
          </span>
        </div>
      </div>

      {/* 4. DESGLOSE DETALLADO DE GASTOS */}
      <div
        className={`p-4 rounded-3xl border transition-all ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-900 shadow-sm'
            : 'bg-slate-900/95 border-slate-800 text-white shadow-md'
        }`}
      >
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3 flex items-center justify-between">
          <span>Distribución de Gastos Operativos</span>
          <span className="text-rose-400 font-black">{formatCOP(totalExpense)}</span>
        </h3>

        {totalExpense === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">
            No se han registrado gastos en este período.
          </p>
        ) : (
          <div className="space-y-2.5">
            {expensesByCategory
              .filter((c) => c.amount > 0)
              .map((cat) => (
                <div key={cat.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold flex items-center gap-1.5 text-slate-300">
                      <span>{cat.icon}</span>
                      <span>{cat.label}</span>
                    </span>
                    <span className="font-mono font-bold text-rose-400">
                      {formatCOP(cat.amount)} ({cat.percent}%)
                    </span>
                  </div>

                  <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
                    <div
                      className="h-full bg-rose-500 rounded-full transition-all"
                      style={{ width: `${cat.percent}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* 5. HISTORIAL DE JORNADAS DE TRANSPORTE */}
      <div
        className={`p-4 rounded-3xl border transition-all ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-900 shadow-sm'
            : 'bg-slate-900/95 border-slate-800 text-white shadow-md'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-amber-400" />
            <span>Historial de Turnos ({filteredShifts.length})</span>
          </h3>
          <span className="text-[10px] text-slate-500 font-bold">Toca para ver detalle</span>
        </div>

        {filteredShifts.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs">
            <Car className="w-8 h-8 mx-auto text-slate-600 mb-2 opacity-50" />
            <p>No hay jornadas de conducción registradas en este período.</p>
            <p className="text-[11px] text-slate-600 mt-1">
              Inicia una jornada en la pestaña "Conductor" y registra tus viajes.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredShifts.map((s) => {
              const txs = s.transactions || [];
              const dayIncome = txs
                .filter((t) => t.type === 'income')
                .reduce((acc, t) => acc + t.amount, 0);
              const dayExpense = txs
                .filter((t) => t.type === 'expense')
                .reduce((acc, t) => acc + t.amount, 0);
              const dayNet = dayIncome - dayExpense;
              const dayTrips = txs.filter((t) => t.type === 'income').length;
              const isExpanded = expandedShiftId === s.id;
              const isToday = s.id === todayShiftId;
              const shiftHours = (s.effectiveDurationMs || 0) / 3600000;

              return (
                <div
                  key={s.id}
                  className={`rounded-2xl border transition-all overflow-hidden ${
                    isExpanded
                      ? 'bg-slate-950 border-amber-500/40 shadow-md'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedShiftId(isExpanded ? null : s.id)}
                    className="w-full p-3 text-left flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div
                        className={`p-2 rounded-xl text-xs font-black ${
                          isToday
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {s.date ? s.date.slice(5) : s.id.slice(5)}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="font-bold text-xs text-white truncate">
                            {s.date || s.id}
                          </p>
                          {isToday && (
                            <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400">
                              Hoy
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400">
                          {dayTrips} viajes • {shiftHours.toFixed(1)} hrs
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <p
                          className={`font-mono font-black text-xs ${
                            dayNet >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatCOP(dayNet)}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          +{formatCOP(dayIncome)} | -{formatCOP(dayExpense)}
                        </p>
                      </div>

                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-amber-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-500" />
                      )}
                    </div>
                  </button>

                  {/* Detalle Desplegable de Movimientos de ese Día */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="px-3 pb-3 pt-1 border-t border-slate-800/80 space-y-1.5"
                      >
                        <p className="text-[10px] font-black uppercase text-slate-400 mb-1">
                          Movimientos Registrados ({txs.length})
                        </p>

                        {txs.length === 0 ? (
                          <p className="text-[11px] text-slate-500">Sin transacciones registradas.</p>
                        ) : (
                          txs.map((tx) => (
                            <div
                              key={tx.id}
                              className="flex items-center justify-between text-[11px] py-1 border-b border-slate-900 last:border-0"
                            >
                              <div className="flex items-center gap-1.5 truncate flex-1 min-w-0 pr-2">
                                <span className={tx.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}>
                                  {tx.type === 'income' ? '🟢' : '🔴'}
                                </span>
                                <span className="text-slate-300 truncate">{tx.description}</span>
                              </div>
                              <span
                                className={`font-mono font-bold shrink-0 ${
                                  tx.type === 'income' ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {tx.type === 'income' ? `+${formatCOP(tx.amount)}` : `-${formatCOP(tx.amount)}`}
                              </span>
                            </div>
                          ))
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
