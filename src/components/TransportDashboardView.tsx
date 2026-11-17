import React, { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Car,
  Play,
  Pause,
  Square,
  PlusCircle,
  MinusCircle,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  Target,
  Fuel,
  Coffee,
  Wrench,
  Percent,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  X,
  Sparkles,
  Award,
} from 'lucide-react';
import {
  db,
  getTodayShiftId,
  ensureShiftExists,
  addTransportTransaction,
  deleteTransportTransaction,
  updateShiftTargetGoal,
  closeTransportShift,
  type WorkShift,
  type TransportTransaction,
  type TransportExpenseCategory,
} from '../db/database';
import { formatCOP, playCashRegisterSuccess } from '../utils/mediaAndFeedback';
import { formatLiveCOPInput, parseLiveCOPInput } from '../utils/formatters';
import { useToast, useConfirm } from './ui/FeedbackSystem';

interface TransportDashboardViewProps {
  highContrastSun: boolean;
}

export const TransportDashboardView: React.FC<TransportDashboardViewProps> = ({
  highContrastSun,
}) => {
  const toast = useToast();
  const { confirm } = useConfirm();
  const todayShiftId = getTodayShiftId();

  // Suscripción reactiva a la jornada actual
  const shift = useLiveQuery(() => db.shifts.get(todayShiftId), [todayShiftId]);

  // Tick para cronómetro en vivo
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Modales
  const [showIncomeModal, setShowIncomeModal] = useState<boolean>(false);
  const [showExpenseModal, setShowExpenseModal] = useState<boolean>(false);
  const [showCloseShiftModal, setShowCloseShiftModal] = useState<boolean>(false);
  const [showGoalModal, setShowGoalModal] = useState<boolean>(false);

  // Form states - Income
  const [incomeAmountInput, setIncomeAmountInput] = useState<string>('');
  const [incomeDesc, setIncomeDesc] = useState<string>('');
  const [incomeApp, setIncomeApp] = useState<string>('InDrive');

  // Form states - Expense
  const [expenseAmountInput, setExpenseAmountInput] = useState<string>('');
  const [expenseCategory, setExpenseCategory] = useState<TransportExpenseCategory>('gasolina');
  const [expenseDesc, setExpenseDesc] = useState<string>('');

  // Form states - Goal
  const [tempGoalInput, setTempGoalInput] = useState<string>('');

  // Transacciones
  const transactions: TransportTransaction[] = useMemo(() => {
    return shift?.transactions || [];
  }, [shift?.transactions]);

  const incomeTransactions = useMemo(
    () => transactions.filter((t) => t.type === 'income'),
    [transactions]
  );
  const expenseTransactions = useMemo(
    () => transactions.filter((t) => t.type === 'expense'),
    [transactions]
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

  const targetGoal = shift?.targetGoal ?? 100000;
  const goalProgress =
    targetGoal > 0 ? Math.min(100, Math.max(0, (netProfit / targetGoal) * 100)) : 0;
  const goalRemaining = Math.max(0, targetGoal - netProfit);

  // Estado del Cronómetro
  const isShiftActive = shift?.status === 'active' && !shift?.isPaused && !!shift?.startedAt;
  const isShiftPaused = !!shift?.isPaused && !!shift?.startedAt && shift?.status !== 'closed';
  const isShiftClosed = shift?.status === 'closed';
  const isShiftNotStarted = !shift?.startedAt || isShiftClosed;

  const activeDurationMs = useMemo(() => {
    if (!shift?.startedAt) return 0;
    if (shift.status === 'closed') return shift.effectiveDurationMs || 0;
    const baseEnd = isShiftPaused && shift.lastPauseStartedAt ? shift.lastPauseStartedAt : now;
    return Math.max(0, baseEnd - shift.startedAt - (shift.accumulatedPausedMs || 0));
  }, [shift, now, isShiftPaused]);

  const activeHours = activeDurationMs / 3600000;
  const netProfitPerHour =
    activeHours >= 0.05 ? Math.round(netProfit / activeHours) : activeHours > 0 ? Math.round(netProfit) : 0;

  const formatStopwatch = (ms: number) => {
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Manejo de Turno
  const handleStartShift = async () => {
    const s = await ensureShiftExists(todayShiftId);
    await db.shifts.update(s.id, {
      status: 'active',
      startedAt: Date.now(),
      endTime: null,
      isPaused: false,
      lastPauseStartedAt: null,
      accumulatedPausedMs: 0,
      targetGoal: s.targetGoal || 100000,
    });
    playCashRegisterSuccess();
    toast.success('🚗 ¡Jornada de Conducción Iniciada!', 'Cronómetro activo y registro de viajes disponible.');
  };

  const handlePauseShift = async () => {
    const s = await ensureShiftExists(todayShiftId);
    await db.shifts.update(s.id, {
      status: 'paused',
      isPaused: true,
      lastPauseStartedAt: Date.now(),
    });
    toast.warning('⏸️ Jornada en Pausa', 'Tiempo activo congelado para no distorsionar tu rentabilidad.');
  };

  const handleResumeShift = async () => {
    const s = await ensureShiftExists(todayShiftId);
    const pauseDelta = s.lastPauseStartedAt ? Date.now() - s.lastPauseStartedAt : 0;
    await db.shifts.update(s.id, {
      status: 'active',
      isPaused: false,
      lastPauseStartedAt: null,
      accumulatedPausedMs: (s.accumulatedPausedMs || 0) + pauseDelta,
    });
    playCashRegisterSuccess();
    toast.success('▶️ ¡Conducción Reanudada!', 'Cronómetro reactivado.');
  };

  // Guardar Transacciones
  const handleSaveIncome = async () => {
    const amount = parseLiveCOPInput(incomeAmountInput);
    if (!amount || amount <= 0) {
      toast.error('⚠️ Monto Inválido', 'Digita un valor mayor a $0 COP.');
      return;
    }

    const desc = incomeDesc.trim() || `${incomeApp} (Viaje #${tripsCount + 1})`;
    await addTransportTransaction(todayShiftId, {
      type: 'income',
      amount,
      description: desc,
      category: 'viaje',
    });

    playCashRegisterSuccess();
    toast.success(`✅ Viaje Registrado: +${formatCOP(amount)}`, desc);
    setIncomeAmountInput('');
    setIncomeDesc('');
    setShowIncomeModal(false);
  };

  const handleSaveExpense = async () => {
    const amount = parseLiveCOPInput(expenseAmountInput);
    if (!amount || amount <= 0) {
      toast.error('⚠️ Monto Inválido', 'Digita un valor mayor a $0 COP.');
      return;
    }

    const catLabels: Record<TransportExpenseCategory, string> = {
      gasolina: '⛽ Gasolina',
      comida: '🍔 Comida / Refrigerio',
      pinchazo: '🔧 Pinchazo / Mecánica',
      comision_app: '📱 Comisión InDrive/App',
      otro: '📝 Gasto Operativo',
    };

    const desc = expenseDesc.trim() || catLabels[expenseCategory];
    await addTransportTransaction(todayShiftId, {
      type: 'expense',
      amount,
      description: desc,
      category: expenseCategory,
    });

    toast.info(`🔴 Gasto Registrado: -${formatCOP(amount)}`, desc);
    setExpenseAmountInput('');
    setExpenseDesc('');
    setShowExpenseModal(false);
  };

  const handleDeleteTx = async (tx: TransportTransaction) => {
    const accepted = await confirm({
      title: '¿Eliminar Movimiento?',
      description: `Se eliminará el registro de "${tx.description}" por ${formatCOP(tx.amount)}.`,
      confirmLabel: '🗑️ Sí, eliminar',
      cancelLabel: 'Conservar',
      variant: 'danger',
    });
    if (!accepted) return;

    await deleteTransportTransaction(todayShiftId, tx.id);
    toast.info('🗑️ Movimiento eliminado');
  };

  // Guardar Meta
  const handleSaveGoal = async () => {
    const parsed = parseLiveCOPInput(tempGoalInput);
    if (parsed <= 0) {
      toast.error('⚠️ Ingresa una meta válida mayor a $0 COP');
      return;
    }
    await updateShiftTargetGoal(todayShiftId, parsed);
    toast.success(`🎯 Meta actualizada a ${formatCOP(parsed)}`);
    setShowGoalModal(false);
  };

  // Cierre de Jornada
  const handleConfirmCloseShift = async () => {
    await closeTransportShift({
      shiftId: todayShiftId,
      effectiveDurationMs: activeDurationMs,
    });
    setShowCloseShiftModal(false);
    toast.success(
      '🏁 Jornada de Conducción Finalizada',
      `Ganancia neta: ${formatCOP(netProfit)}. Backup local automático generado.`
    );
  };

  return (
    <div className="max-w-lg mx-auto px-4 space-y-3.5 pb-20">
      {/* 1. SECCIÓN: META DEL DÍA (TARGET GOAL) */}
      <div
        className={`p-3.5 rounded-2xl border transition-all ${
          highContrastSun
            ? 'bg-amber-50/90 border-amber-300 text-slate-900 shadow-sm'
            : 'bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/40 border-amber-500/30 text-white shadow-lg'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-wider text-amber-400">
                Meta Financiera del Día
              </p>
              <p className="text-xl font-black tracking-tight">{formatCOP(targetGoal)}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setTempGoalInput(formatLiveCOPInput(String(targetGoal)));
              setShowGoalModal(true);
            }}
            className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-black transition-all active:scale-95 cursor-pointer"
          >
            Ajustar Meta
          </button>
        </div>

        {/* Barra de Progreso hacia la Meta */}
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-slate-400">
              Progreso: <strong className="text-emerald-400">{goalProgress.toFixed(0)}%</strong>
            </span>
            <span className={netProfit >= targetGoal ? 'text-emerald-400' : 'text-amber-400'}>
              {netProfit >= targetGoal
                ? `🎉 ¡Meta superada por +${formatCOP(netProfit - targetGoal)}!`
                : `Faltan ${formatCOP(goalRemaining)}`}
            </span>
          </div>

          <div className="w-full h-3 rounded-full bg-slate-800/90 overflow-hidden p-0.5 border border-slate-700/80">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${goalProgress}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className={`h-full rounded-full transition-all ${
                netProfit >= targetGoal
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-md shadow-emerald-500/50'
                  : 'bg-gradient-to-r from-amber-500 to-orange-500 shadow-md shadow-amber-500/50'
              }`}
            />
          </div>
        </div>
      </div>

      {/* 2. SECCIÓN: CONTROL DE JORNADA (CRONÓMETRO + BOTÓN GIGANTE) */}
      <div
        className={`p-4 rounded-3xl border transition-all ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-900 shadow-md'
            : 'bg-slate-900/95 border-slate-800 text-white shadow-xl'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">
              Tiempo Conectado
            </span>
          </div>

          {/* Badge de Estado */}
          {isShiftActive && (
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              EN VIVO
            </span>
          )}
          {isShiftPaused && (
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-400 border border-amber-500/40">
              ⏸️ PAUSADO
            </span>
          )}
          {isShiftNotStarted && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              {isShiftClosed ? 'JORNADA CERRADA' : 'SIN INICIAR'}
            </span>
          )}
        </div>

        {/* Display del Cronómetro */}
        <div className="text-center py-2">
          <div className="font-mono text-4xl sm:text-5xl font-black tracking-tight text-white drop-shadow-md">
            {formatStopwatch(activeDurationMs)}
          </div>
          <p className="text-[11px] font-semibold text-slate-400 mt-1">
            {activeHours >= 0.05
              ? `Ritmo en vivo: ${formatCOP(netProfitPerHour)}/h`
              : 'Empieza a rodar y registra tus carreras'}
          </p>
        </div>

        {/* Botones de Control de Jornada */}
        <div className="mt-4">
          {isShiftNotStarted ? (
            <button
              type="button"
              onClick={handleStartShift}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-base shadow-xl shadow-emerald-950/50 flex items-center justify-center gap-2 active:scale-[0.99] transition-all cursor-pointer"
            >
              <Play className="w-5 h-5 fill-white" />
              <span>▶ EMPEZAR JORNADA</span>
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {isShiftActive ? (
                <button
                  type="button"
                  onClick={handlePauseShift}
                  className="py-3.5 px-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer shadow-md"
                >
                  <Pause className="w-4 h-4 fill-slate-950" />
                  <span>PAUSAR TURNO</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleResumeShift}
                  className="py-3.5 px-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer shadow-md"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>REANUDAR</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowCloseShiftModal(true)}
                className="py-3.5 px-3 rounded-2xl bg-rose-600/90 hover:bg-rose-500 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer shadow-md"
              >
                <Square className="w-4 h-4 fill-white" />
                <span>TERMINAR JORNADA</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 3. SECCIÓN: BOTONES DE ACCIÓN RÁPIDA (SOLO SI JORNADA ESTÁ ACTIVA O PAUSADA) */}
      {!isShiftNotStarted && (
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => {
              setIncomeAmountInput('');
              setIncomeDesc('');
              setShowIncomeModal(true);
            }}
            className="py-3.5 px-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 active:scale-95 transition-all cursor-pointer"
          >
            <PlusCircle className="w-5 h-5" />
            <span>+ Registrar Viaje</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setExpenseAmountInput('');
              setExpenseDesc('');
              setShowExpenseModal(true);
            }}
            className="py-3.5 px-3 rounded-2xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-rose-950/40 active:scale-95 transition-all cursor-pointer"
          >
            <MinusCircle className="w-5 h-5" />
            <span>- Registrar Gasto</span>
          </button>
        </div>
      )}

      {/* 4. SECCIÓN: PANEL FINANCIERO EN VIVO (KPIS) */}
      <div className="grid grid-cols-3 gap-2">
        {/* Card 1: Ingresos */}
        <div
          className={`p-3 rounded-2xl border text-center transition-all ${
            highContrastSun
              ? 'bg-emerald-50 border-emerald-300 text-slate-900'
              : 'bg-slate-900/90 border-emerald-500/30 text-white'
          }`}
        >
          <div className="flex items-center justify-center gap-1 text-[10px] font-black uppercase text-emerald-400">
            <TrendingUp className="w-3 h-3" />
            <span>Ingresos</span>
          </div>
          <p className="text-base sm:text-lg font-black mt-1 text-emerald-400 tracking-tight">
            {formatCOP(totalIncome)}
          </p>
          <span className="text-[10px] text-slate-400 font-bold">{tripsCount} viajes</span>
        </div>

        {/* Card 2: Gastos */}
        <div
          className={`p-3 rounded-2xl border text-center transition-all ${
            highContrastSun
              ? 'bg-rose-50 border-rose-300 text-slate-900'
              : 'bg-slate-900/90 border-rose-500/30 text-white'
          }`}
        >
          <div className="flex items-center justify-center gap-1 text-[10px] font-black uppercase text-rose-400">
            <TrendingDown className="w-3 h-3" />
            <span>Gastos</span>
          </div>
          <p className="text-base sm:text-lg font-black mt-1 text-rose-400 tracking-tight">
            {formatCOP(totalExpense)}
          </p>
          <span className="text-[10px] text-slate-400 font-bold">
            {expenseTransactions.length} registros
          </span>
        </div>

        {/* Card 3: Ganancia Neta */}
        <div
          className={`p-3 rounded-2xl border text-center transition-all ${
            netProfit >= 0
              ? highContrastSun
                ? 'bg-teal-50 border-teal-300 text-slate-900'
                : 'bg-slate-900/90 border-teal-500/40 text-white'
              : highContrastSun
              ? 'bg-rose-100 border-rose-400 text-slate-900'
              : 'bg-rose-950/50 border-rose-500/50 text-white'
          }`}
        >
          <div className="flex items-center justify-center gap-1 text-[10px] font-black uppercase text-teal-400">
            <DollarSign className="w-3 h-3" />
            <span>Ganancia Neta</span>
          </div>
          <p
            className={`text-base sm:text-lg font-black mt-1 tracking-tight ${
              netProfit >= 0 ? 'text-teal-300' : 'text-rose-400'
            }`}
          >
            {formatCOP(netProfit)}
          </p>
          <span className="text-[10px] text-slate-400 font-bold">
            {activeHours >= 0.05 ? `${formatCOP(netProfitPerHour)}/h` : 'Libre'}
          </span>
        </div>
      </div>

      {/* 5. SECCIÓN: HISTORIAL DE MOVIMIENTOS DEL TURNO */}
      <div
        className={`p-4 rounded-3xl border transition-all ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-900 shadow-sm'
            : 'bg-slate-900/95 border-slate-800 text-white shadow-md'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Car className="w-3.5 h-3.5 text-blue-400" />
            <span>Movimientos de Hoy ({transactions.length})</span>
          </h3>
          <span className="text-[10px] font-bold text-slate-500">Más recientes arriba</span>
        </div>

        {transactions.length === 0 ? (
          <div className="text-center py-6 text-slate-500 text-xs">
            No has registrado carreras ni gastos aún en este turno.
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {transactions
              .slice()
              .reverse()
              .map((tx) => {
                const isIncome = tx.type === 'income';
                return (
                  <div
                    key={tx.id}
                    className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 transition-all ${
                      isIncome
                        ? 'bg-emerald-950/20 border-emerald-500/20 hover:border-emerald-500/40'
                        : 'bg-rose-950/20 border-rose-500/20 hover:border-rose-500/40'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div
                        className={`p-2 rounded-lg shrink-0 ${
                          isIncome
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-rose-500/20 text-rose-400'
                        }`}
                      >
                        {isIncome ? (
                          <Car className="w-4 h-4" />
                        ) : tx.category === 'gasolina' ? (
                          <Fuel className="w-4 h-4" />
                        ) : tx.category === 'comida' ? (
                          <Coffee className="w-4 h-4" />
                        ) : tx.category === 'pinchazo' ? (
                          <Wrench className="w-4 h-4" />
                        ) : (
                          <MinusCircle className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-xs truncate text-white">{tx.description}</p>
                        <p className="text-[10px] text-slate-400">
                          {new Date(tx.timestamp).toLocaleTimeString('es-CO', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`font-black text-xs ${
                          isIncome ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {isIncome ? `+${formatCOP(tx.amount)}` : `-${formatCOP(tx.amount)}`}
                      </span>

                      <button
                        type="button"
                        onClick={() => handleDeleteTx(tx)}
                        title="Eliminar"
                        className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* ================= MODAL: REGISTRAR VIAJE (INCOME) ================= */}
      <AnimatePresence>
        {showIncomeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm rounded-3xl bg-slate-900 border border-slate-800 p-5 shadow-2xl text-white space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                    <PlusCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-sm">Registrar Viaje / Carrera</h3>
                    <p className="text-[11px] text-slate-400">Ingreso por transporte de pasajero</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIncomeModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Selector de App */}
              <div>
                <label className="text-[11px] font-bold text-slate-400 mb-1.5 block">
                  Plataforma / Fuente
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {['InDrive', 'Picap', 'Efectivo'].map((app) => (
                    <button
                      key={app}
                      type="button"
                      onClick={() => setIncomeApp(app)}
                      className={`py-1.5 px-2 rounded-xl text-xs font-bold border transition-all ${
                        incomeApp === app
                          ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                          : 'bg-slate-800/80 border-slate-700 text-slate-400'
                      }`}
                    >
                      {app}
                    </button>
                  ))}
                </div>
              </div>

              {/* Input Valor Cobrado */}
              <div>
                <label className="text-[11px] font-bold text-slate-400 mb-1.5 block">
                  Valor Cobrado (COP)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={incomeAmountInput}
                  onChange={(e) => setIncomeAmountInput(formatLiveCOPInput(e.target.value))}
                  placeholder="$ 14.000"
                  autoFocus
                  className="w-full py-3 px-4 rounded-xl bg-slate-950 border border-slate-700 text-emerald-400 text-xl font-black focus:outline-none focus:border-emerald-500"
                />

                {/* Chips de montos rápidos */}
                <div className="flex gap-1.5 mt-2">
                  {[8000, 12000, 15000, 20000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setIncomeAmountInput(formatLiveCOPInput(String(preset)))}
                      className="flex-1 py-1 rounded-lg bg-slate-800 text-slate-300 text-[11px] font-bold hover:bg-slate-700 border border-slate-700"
                    >
                      ${(preset / 1000).toFixed(0)}k
                    </button>
                  ))}
                </div>
              </div>

              {/* Detalle o Ruta Opcional */}
              <div>
                <label className="text-[11px] font-bold text-slate-400 mb-1 block">
                  Trayecto / Nota (Opcional)
                </label>
                <input
                  type="text"
                  value={incomeDesc}
                  onChange={(e) => setIncomeDesc(e.target.value)}
                  placeholder="Ej. Poblado a Laureles, 5ta carrera"
                  className="w-full py-2 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>

              <button
                type="button"
                onClick={handleSaveIncome}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm shadow-lg shadow-emerald-950/50 active:scale-95 transition-all"
              >
                Guardar Viaje
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================= MODAL: REGISTRAR GASTO (EXPENSE) ================= */}
      <AnimatePresence>
        {showExpenseModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm rounded-3xl bg-slate-900 border border-slate-800 p-5 shadow-2xl text-white space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400">
                    <MinusCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-sm">Registrar Gasto de Conducción</h3>
                    <p className="text-[11px] text-slate-400">Resta directa de tu ganancia neta</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Selector de Categoría */}
              <div>
                <label className="text-[11px] font-bold text-slate-400 mb-1.5 block">
                  Categoría del Gasto
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { id: 'gasolina', label: '⛽ Gasolina' },
                      { id: 'comida', label: '🍔 Comida' },
                      { id: 'pinchazo', label: '🔧 Pinchazo' },
                      { id: 'comision_app', label: '📱 Comisión App' },
                    ] as const
                  ).map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setExpenseCategory(cat.id)}
                      className={`py-1.5 px-2 rounded-xl text-xs font-bold border transition-all text-left ${
                        expenseCategory === cat.id
                          ? 'bg-rose-600 text-white border-rose-500 shadow-sm'
                          : 'bg-slate-800/80 border-slate-700 text-slate-400'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Input Valor Gasto */}
              <div>
                <label className="text-[11px] font-bold text-slate-400 mb-1.5 block">
                  Valor del Gasto (COP)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={expenseAmountInput}
                  onChange={(e) => setExpenseAmountInput(formatLiveCOPInput(e.target.value))}
                  placeholder="$ 15.000"
                  autoFocus
                  className="w-full py-3 px-4 rounded-xl bg-slate-950 border border-slate-700 text-rose-400 text-xl font-black focus:outline-none focus:border-rose-500"
                />

                {/* Chips de montos rápidos */}
                <div className="flex gap-1.5 mt-2">
                  {[5000, 10000, 15000, 20000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setExpenseAmountInput(formatLiveCOPInput(String(preset)))}
                      className="flex-1 py-1 rounded-lg bg-slate-800 text-slate-300 text-[11px] font-bold hover:bg-slate-700 border border-slate-700"
                    >
                      ${(preset / 1000).toFixed(0)}k
                    </button>
                  ))}
                </div>
              </div>

              {/* Detalle Opcional */}
              <div>
                <label className="text-[11px] font-bold text-slate-400 mb-1 block">
                  Detalle (Opcional)
                </label>
                <input
                  type="text"
                  value={expenseDesc}
                  onChange={(e) => setExpenseDesc(e.target.value)}
                  placeholder="Ej. Terpel Las Vegas, Despinche San Juan"
                  className="w-full py-2 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-rose-500"
                />
              </div>

              <button
                type="button"
                onClick={handleSaveExpense}
                className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-sm shadow-lg shadow-rose-950/50 active:scale-95 transition-all"
              >
                Guardar Gasto
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================= MODAL: AJUSTAR META (TARGET GOAL) ================= */}
      <AnimatePresence>
        {showGoalModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm rounded-3xl bg-slate-900 border border-slate-800 p-5 shadow-2xl text-white space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
                    <Target className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-sm">Definir Meta del Día</h3>
                    <p className="text-[11px] text-slate-400">Cuánto deseas ganar libre hoy</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGoalModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 mb-1.5 block">
                  Meta Financiera (COP)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={tempGoalInput}
                  onChange={(e) => setTempGoalInput(formatLiveCOPInput(e.target.value))}
                  placeholder="$ 100.000"
                  autoFocus
                  className="w-full py-3 px-4 rounded-xl bg-slate-950 border border-slate-700 text-amber-400 text-xl font-black focus:outline-none focus:border-amber-500"
                />

                <div className="grid grid-cols-4 gap-1.5 mt-2">
                  {[80000, 100000, 120000, 150000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setTempGoalInput(formatLiveCOPInput(String(preset)))}
                      className="py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700 border border-slate-700"
                    >
                      ${(preset / 1000).toFixed(0)}k
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleSaveGoal}
                className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm shadow-lg shadow-amber-950/50 active:scale-95 transition-all"
              >
                Guardar Meta
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================= MODAL: RESUMEN DE JORNADA (AUDITORÍA INDRIVE) ================= */}
      <AnimatePresence>
        {showCloseShiftModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm rounded-3xl bg-slate-900 border border-slate-800 p-5 shadow-2xl text-white space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400">
                    <Award className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-sm">Auditoría Financiera de Jornada</h3>
                    <p className="text-[11px] text-slate-400">Balance de Conducción InDrive/Picap</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCloseShiftModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 1. Tiempo Conectado */}
              <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800 text-center">
                <p className="text-[10px] font-black uppercase text-slate-400">Tiempo Conectado</p>
                <p className="font-mono text-2xl font-black text-white mt-0.5">
                  {formatStopwatch(activeDurationMs)}
                </p>
                <p className="text-[10px] text-slate-500">
                  {activeHours.toFixed(2)} horas activas en la calle
                </p>
              </div>

              {/* 2. Desglose Financiero */}
              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2 text-xs">
                <div className="flex justify-between items-center text-slate-300">
                  <span>Ingresos ({tripsCount} viajes):</span>
                  <strong className="text-emerald-400 font-black">+{formatCOP(totalIncome)}</strong>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span>Gastos operativos:</span>
                  <strong className="text-rose-400 font-black">-{formatCOP(totalExpense)}</strong>
                </div>
                <div className="h-px bg-slate-800 my-1" />
                <div className="flex justify-between items-center text-sm">
                  <span className="font-bold text-white">Ganancia Neta Final:</span>
                  <strong
                    className={`font-black text-base ${
                      netProfit >= 0 ? 'text-teal-300' : 'text-rose-400'
                    }`}
                  >
                    {formatCOP(netProfit)}
                  </strong>
                </div>
                <div className="flex justify-between items-center text-[11px] text-slate-400">
                  <span>Meta establecida:</span>
                  <span className="font-bold">{formatCOP(targetGoal)}</span>
                </div>
                <div className="flex justify-between items-center text-[11px] text-slate-400">
                  <span>Ganancia Neta por Hora:</span>
                  <strong className="text-amber-400 font-black">
                    {formatCOP(netProfitPerHour)}/h
                  </strong>
                </div>
              </div>

              {/* 3. Evaluación Fuerte de Rentabilidad */}
              <div
                className={`p-3.5 rounded-2xl border text-xs leading-relaxed ${
                  netProfit >= targetGoal
                    ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
                    : 'bg-amber-950/40 border-amber-500/50 text-amber-200'
                }`}
              >
                {netProfit >= targetGoal ? (
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-black text-emerald-300">¡Jornada Excelente!</p>
                      <p className="mt-0.5">
                        Superaste la meta de {formatCOP(targetGoal)}. El transporte rindió hoy con
                        una ganancia de {formatCOP(netProfitPerHour)}/hora.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-black text-amber-300">Meta no alcanzada</p>
                      <p className="mt-0.5">
                        Ganancia por hora: {formatCOP(netProfitPerHour)}/h. Evalúa si la tarifa
                        promedio compensa la gasolina y el tiempo invertido.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Botón de Confirmación */}
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={handleConfirmCloseShift}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-sm shadow-xl active:scale-95 transition-all"
                >
                  Confirmar y Cerrar Jornada
                </button>
                <button
                  type="button"
                  onClick={() => setShowCloseShiftModal(false)}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
                >
                  Seguir Conduciendo
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
