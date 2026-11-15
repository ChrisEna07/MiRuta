import React, { useState, useMemo, useEffect } from 'react';
import {
  FileText,
  Share2,
  Download,
  Lock,
  Eye,
  Calendar,
  TrendingUp,
  Fuel,
  Clock,
  CheckCircle2,
  ShieldAlert,
  Scale,
  AlertOctagon,
  PlusCircle,
  Trash2,
  MessageSquareWarning,
  Save,
  Sparkles,
  Loader2,
  Copy
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db,
  getDefaultPackageRate,
  getTodayShiftId,
  type DeductionType,
  type PaymentMethodType,
  type SettlementStatus
} from '../db/database';
import { formatCOP } from '../utils/mediaAndFeedback';
import { formatLiveCOPInput, parseLiveCOPInput, sanitizeTrackingInput } from '../utils/formatters';
import { generateAndShareQuincenaPDF } from '../utils/pdfReport';
import { syncToSupabase } from '../services/supabaseSync';
import { generateQuincenaAuditClaimText } from '../services/aiCopilotService';
import { useToast, useConfirm } from './ui/FeedbackSystem';

interface QuincenaAccountingViewProps {
  highContrastSun: boolean;
}

type CutoffMode = 'q1' | 'q2' | 'custom';

export const QuincenaAccountingView: React.FC<QuincenaAccountingViewProps> = ({
  highContrastSun
}) => {
  const toast = useToast();
  const { confirm } = useConfirm();
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const defaultCutoff: CutoffMode = now.getDate() <= 15 ? 'q1' : 'q2';

  const [selectedMonth, setSelectedMonth] = useState<string>(currentYearMonth);
  const [cutoffMode, setCutoffMode] = useState<CutoffMode>(defaultCutoff);
  const [customStart, setCustomStart] = useState<string>(`${currentYearMonth}-01`);
  const [customEnd, setCustomEnd] = useState<string>(`${currentYearMonth}-15`);
  const [contractorName, setContractorName] = useState<string>('Christian Romero');
  const [employerName, setEmployerName] = useState<string>('Sr. Juan');
  const [activeTab, setActiveTab] = useState<'private' | 'sr_juan'>('private');
  const [generatingPdf, setGeneratingPdf] = useState<boolean>(false);

  // Estado Modal de Descuento Manual
  const [showDiscountModal, setShowDiscountModal] = useState<boolean>(false);
  const [discountType, setDiscountType] = useState<DeductionType>('manual_discount');
  const [discountTitle, setDiscountTitle] = useState<string>('');
  const [discountAmount, setDiscountAmount] = useState<string>('');
  const [discountTracking, setDiscountTracking] = useState<string>('');
  const [discountNotes, setDiscountNotes] = useState<string>('');
  const [discountApplyPdf, setDiscountApplyPdf] = useState<boolean>(false);

  // Estado Conciliación / Auditoría de Pago Recibido
  const [actualPaidInput, setActualPaidInput] = useState<string>('');
  const [reportedPkgsInput, setReportedPkgsInput] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('Nequi');
  const [settlementNotes, setSettlementNotes] = useState<string>('');
  const [settlementSavedMsg, setSettlementSavedMsg] = useState<string>('');

  // Estado Redactor IA de Sustento / Reclamo Quincenal (v5.0)
  const [aiClaimDraft, setAiClaimDraft] = useState<string>('');
  const [isDraftingClaim, setIsDraftingClaim] = useState<boolean>(false);

  const defaultRate = getDefaultPackageRate();

  const allPackages = useLiveQuery(() => db.packages.toArray(), []) || [];
  const allShifts = useLiveQuery(() => db.shifts.toArray(), []) || [];
  const allDeductions = useLiveQuery(() => db.deductions.toArray(), []) || [];
  const allSettlements = useLiveQuery(() => db.settlements.toArray(), []) || [];

  const { startDateStr, endDateStr, periodLabel, periodKey } = useMemo(() => {
    const [yearStr, monthStr] = selectedMonth.split('-');
    const year = parseInt(yearStr, 10) || now.getFullYear();
    const month = parseInt(monthStr, 10) || now.getMonth() + 1;
    const lastDayOfMonth = new Date(year, month, 0).getDate();
    const monthName = new Date(year, month - 1, 1).toLocaleString('es-CO', { month: 'long' });
    const capMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    if (cutoffMode === 'q1') {
      return {
        startDateStr: `${selectedMonth}-01`,
        endDateStr: `${selectedMonth}-15`,
        periodLabel: `Quincena 1 (01 al 15 de ${capMonth} ${year})`,
        periodKey: `${selectedMonth}-Q1`
      };
    }
    if (cutoffMode === 'q2') {
      return {
        startDateStr: `${selectedMonth}-16`,
        endDateStr: `${selectedMonth}-${String(lastDayOfMonth).padStart(2, '0')}`,
        periodLabel: `Quincena 2 (16 al ${lastDayOfMonth} de ${capMonth} ${year})`,
        periodKey: `${selectedMonth}-Q2`
      };
    }
    return {
      startDateStr: customStart,
      endDateStr: customEnd,
      periodLabel: `Corte Personalizado (${customStart} a ${customEnd})`,
      periodKey: `CUSTOM-${customStart}-${customEnd}`
    };
  }, [selectedMonth, cutoffMode, customStart, customEnd]);

  // Cargar datos guardados de la liquidación (settlement) para este periodo
  const existingSettlement = useMemo(() => {
    return allSettlements.find((s) => s.periodKey === periodKey);
  }, [allSettlements, periodKey]);

  useEffect(() => {
    if (existingSettlement) {
      setActualPaidInput(
        existingSettlement.actualPaidAmount > 0
          ? formatLiveCOPInput(String(existingSettlement.actualPaidAmount))
          : ''
      );
      setReportedPkgsInput(
        existingSettlement.paidPackagesCountReportedByCompany !== undefined
          ? String(existingSettlement.paidPackagesCountReportedByCompany)
          : ''
      );
      setPaymentMethod(existingSettlement.paymentMethod || 'Nequi');
      setSettlementNotes(existingSettlement.notes || '');
    } else {
      setActualPaidInput('');
      setReportedPkgsInput('');
      setPaymentMethod('Nequi');
      setSettlementNotes('');
    }
  }, [existingSettlement?.id, periodKey]);

  // Filtrar paquetes, turnos y deducciones del rango
  const filteredPackages = useMemo(() => {
    return allPackages.filter((pkg) => {
      const dateKey = pkg.deliveredAt
        ? new Date(pkg.deliveredAt).toISOString().slice(0, 10)
        : pkg.shiftId || new Date(pkg.scannedAt).toISOString().slice(0, 10);
      return dateKey >= startDateStr && dateKey <= endDateStr;
    });
  }, [allPackages, startDateStr, endDateStr]);

  const filteredShifts = useMemo(() => {
    return allShifts.filter((s) => s.date >= startDateStr && s.date <= endDateStr);
  }, [allShifts, startDateStr, endDateStr]);

  const filteredDeductions = useMemo(() => {
    return allDeductions.filter((d) => d.date >= startDateStr && d.date <= endDateStr);
  }, [allDeductions, startDateStr, endDateStr]);

  const deliveredPackages = filteredPackages.filter((p) => p.status === 'delivered');
  const grossIncome = deliveredPackages.reduce((sum, p) => sum + (p.rate || defaultRate), 0);
  const totalDeductionsCOP = filteredDeductions.reduce((sum, d) => sum + (d.amount || 0), 0);
  const expectedNetFromCompany = Math.max(0, grossIncome - totalDeductionsCOP);

  const totalFuelQuincena = filteredShifts.reduce(
    (sum, s) => sum + (s.fuelExpense || 0) + (s.otherExpense || 0),
    0
  );

  const totalHoursQuincena = useMemo(() => {
    let totalMs = 0;
    for (const s of filteredShifts) {
      if (s.startedAt) {
        if (s.effectiveDurationMs && s.effectiveDurationMs > 0) {
          totalMs += s.effectiveDurationMs;
        } else {
          const shiftEnd = s.endTime || (s.id === getTodayShiftId() ? Date.now() : s.startedAt + 8 * 3600000);
          const elapsed = Math.max(
            0,
            shiftEnd - s.startedAt - (s.accumulatedPausedMs || 0)
          );
          totalMs += Math.min(12 * 3600000, Math.max(1800000, elapsed));
        }
      }
    }
    const minEstimatedHours = deliveredPackages.length / 6.5;
    return Math.max(totalMs / 3600000, minEstimatedHours, 0.5);
  }, [filteredShifts, deliveredPackages.length]);

  const netFreePocketProfit = grossIncome - totalDeductionsCOP - totalFuelQuincena;
  const realNetPerHour = totalHoursQuincena > 0 ? netFreePocketProfit / totalHoursQuincena : 0;

  // Equivalencia de multas en paquetes entregados
  const lostPkgEquivalent = Math.ceil(120000 / defaultRate);
  const fakeSigEquivalent = Math.ceil(600000 / defaultRate);

  // Acciones rápidas de Penalizaciones y Descuentos
  const handleQuickAddPenalty = async (
    type: DeductionType,
    title: string,
    amount: number
  ) => {
    const equivPkgs = Math.ceil(amount / defaultRate);
    const accepted = await confirm({
      title: `¿Registrar "${title}"?`,
      description: `Se descontará -${formatCOP(amount, true)} en la liquidación de este corte quincenal.`,
      details: [
        `Impacto operativo: Equivale a ${equivPkgs} paquetes entregados a ${formatCOP(defaultRate)} c/u.`,
        'Puedes activar o desactivar si aparece en el PDF del Sr. Juan.',
      ],
      confirmLabel: 'Sí, registrar penalización',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!accepted) return;

    const targetDate =
      startDateStr <= getTodayShiftId() && getTodayShiftId() <= endDateStr
        ? getTodayShiftId()
        : endDateStr;

    await db.deductions.add({
      date: targetDate,
      shiftId: targetDate,
      type,
      title,
      amount,
      notes: `Equivale a ${equivPkgs} entregas (${formatCOP(defaultRate)}/paq)`,
      applyToJuanPdf: true
    });
    toast.warning(`⚠️ Penalización registrada (-${formatCOP(amount)})`, title);
    syncToSupabase(true).catch(() => {});
  };

  const handleSaveManualDiscount = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseLiveCOPInput(discountAmount);
    if (!discountTitle.trim() || numericAmount <= 0) {
      toast.error(
        '⚠️ Datos incompletos',
        'Ingresa el concepto y un monto válido mayor a $0 COP.'
      );
      return;
    }

    const targetDate =
      startDateStr <= getTodayShiftId() && getTodayShiftId() <= endDateStr
        ? getTodayShiftId()
        : endDateStr;

    await db.deductions.add({
      date: targetDate,
      shiftId: targetDate,
      type: discountType,
      title: discountTitle.trim(),
      amount: numericAmount,
      trackingNumber: sanitizeTrackingInput(discountTracking) || undefined,
      notes: discountNotes.trim(),
      applyToJuanPdf: discountApplyPdf
    });

    toast.success(
      `✅ Descuento registrado (-${formatCOP(numericAmount)})`,
      discountTitle.trim()
    );
    syncToSupabase(true).catch(() => {});

    setDiscountTitle('');
    setDiscountAmount('');
    setDiscountTracking('');
    setDiscountNotes('');
    setShowDiscountModal(false);
  };

  const handleToggleDeductionPdf = async (id?: number, current?: boolean) => {
    if (id === undefined) return;
    await db.deductions.update(id, { applyToJuanPdf: !current });
    toast.info(
      !current
        ? '📄 Descuento incluido en el PDF para el Sr. Juan'
        : '🔒 Descuento marcado solo para tu control privado'
    );
  };

  const handleDeleteDeduction = async (id?: number) => {
    if (id === undefined) return;
    const accepted = await confirm({
      title: '¿Eliminar este descuento o penalización?',
      description: 'Se recalculará inmediatamente el neto de tu quincena.',
      confirmLabel: '🗑️ Eliminar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!accepted) return;
    await db.deductions.delete(id);
    toast.info('🗑️ Descuento eliminado');
    syncToSupabase(true).catch(() => {});
  };

  // --- CÁLCULO DE AUDITORÍA Y CONCILIACIÓN: LO CALCULADO VS. LO PAGADO POR LA EMPRESA ---
  const hasEnteredPaidAmount = actualPaidInput.trim() !== '';
  const actualPaidNumber = parseLiveCOPInput(actualPaidInput);
  const reportedPkgsNumber =
    reportedPkgsInput.trim() !== ''
      ? Math.max(0, parseInt(reportedPkgsInput.replace(/\D/g, ''), 10) || 0)
      : undefined;

  const paymentDiff = actualPaidNumber - expectedNetFromCompany;
  const missingPackagesEquivalent =
    paymentDiff < 0 ? Math.round(Math.abs(paymentDiff) / defaultRate) : 0;
  const missingPkgsByCount =
    reportedPkgsNumber !== undefined
      ? deliveredPackages.length - reportedPkgsNumber
      : missingPackagesEquivalent;

  const handleSaveSettlementAudit = async () => {
    let status: SettlementStatus = 'pending';
    if (hasEnteredPaidAmount) {
      if (paymentDiff === 0) status = 'balanced';
      else if (paymentDiff < 0) status = 'underpaid_dispute';
      else status = 'overpaid';
    }

    const payload = {
      periodKey,
      startDate: startDateStr,
      endDate: endDateStr,
      expectedGross: grossIncome,
      totalDeductions: totalDeductionsCOP,
      expectedNet: expectedNetFromCompany,
      actualPaidAmount: actualPaidNumber,
      paidPackagesCountReportedByCompany: reportedPkgsNumber,
      paymentDate: new Date().toISOString().slice(0, 10),
      paymentMethod,
      status,
      notes: settlementNotes
    };

    if (existingSettlement?.id !== undefined) {
      await db.settlements.update(existingSettlement.id, payload);
    } else {
      await db.settlements.add(payload);
    }

    setSettlementSavedMsg('✅ Auditoría de liquidación guardada en IndexedDB.');
    toast.success('✅ Auditoría de liquidación guardada', `${periodLabel} • ${paymentMethod}`);
    syncToSupabase(true).catch(() => {});
    setTimeout(() => setSettlementSavedMsg(''), 3500);
  };

  const buildAuditDisputeWhatsAppUrl = (): string => {
    const diffAbs = formatCOP(Math.abs(paymentDiff), true);
    const msg = `Hola ${employerName}, cordial saludo. Revisando la liquidación de *${periodLabel}* en mi registro de *MiRuta*, tengo un total verificable de *${
      deliveredPackages.length
    } paquetes entregados* (${formatCOP(expectedNetFromCompany, true)} neto esperado) y el pago recibido fue de *${formatCOP(
      actualPaidNumber,
      true
    )}*. Hay una diferencia a revisar de *-${diffAbs}* (equivalente a *~${missingPackagesEquivalent} paquetes*). Te adjunto el PDF con el anexo detallado de cada guía y hora de entrega para validar. ¡Gracias!`;
    return `https://wa.me/?text=${encodeURIComponent(msg)}`;
  };

  const handleGenerateAIClaimDraft = async () => {
    setIsDraftingClaim(true);
    try {
      const res = await generateQuincenaAuditClaimText({
        periodLabel,
        employerName,
        contractorName,
        deliveredPackages,
        deductions: filteredDeductions,
        expectedNetCOP: expectedNetFromCompany,
        actualPaidCOP: actualPaidNumber,
        reportedPkgsByCompany: reportedPkgsNumber,
        paymentMethod,
      });
      setAiClaimDraft(res.messageText);
      toast.success(
        '🧠 Sustento de cobro / reclamo redactado',
        `Listo para copiar o enviar por WhatsApp al ${employerName}.`
      );
    } finally {
      setIsDraftingClaim(false);
    }
  };

  // Tabla resumen por día
  const dailySummary = useMemo(() => {
    const map = new Map<string, { delivered: number; issues: number; subtotal: number }>();
    for (const pkg of filteredPackages) {
      const d = pkg.deliveredAt
        ? new Date(pkg.deliveredAt).toISOString().slice(0, 10)
        : pkg.shiftId || new Date(pkg.scannedAt).toISOString().slice(0, 10);
      const curr = map.get(d) || { delivered: 0, issues: 0, subtotal: 0 };
      if (pkg.status === 'delivered') {
        curr.delivered += 1;
        curr.subtotal += pkg.rate || defaultRate;
      } else if (pkg.status === 'issue') {
        curr.issues += 1;
      }
      map.set(d, curr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([, val]) => val.delivered > 0 || val.issues > 0);
  }, [filteredPackages, defaultRate]);

  const handleExportPDF = async (mode: 'share' | 'download') => {
    setGeneratingPdf(true);
    try {
      await generateAndShareQuincenaPDF(
        {
          periodLabel,
          contractorName,
          employerName,
          packages: filteredPackages,
          deductions: filteredDeductions
        },
        mode
      );
      toast.success(
        mode === 'share'
          ? `📄 PDF generado para enviar al ${employerName}`
          : '📥 Cuenta de cobro PDF descargada',
        `${deliveredPackages.length} paquetes incluidos en el reporte.`
      );
    } catch {
      toast.error('⚠️ Error al generar el PDF');
    } finally {
      setGeneratingPdf(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-2.5 space-y-3.5 pb-10">
      {/* Selector de Corte Quincenal (15 y 30) */}
      <div
        className={`rounded-3xl border p-4 shadow-lg space-y-3 ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-950'
            : 'bg-slate-900/95 border-slate-800 text-slate-50'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-black flex items-center gap-1.5">
              <Calendar className="w-5 h-5 text-blue-400" />
              <span>Liquidación y Auditoría Quincenal</span>
            </h2>
            <p className="text-xs text-slate-400">{periodLabel}</p>
          </div>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className={`rounded-xl px-2.5 py-1.5 text-xs font-bold border ${
              highContrastSun
                ? 'bg-slate-100 border-slate-300 text-slate-950'
                : 'bg-slate-800 border-slate-700 text-white'
            }`}
          />
        </div>

        {/* Botones de Corte */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setCutoffMode('q1')}
            className={`py-2.5 px-2 rounded-xl text-xs font-black border transition-all ${
              cutoffMode === 'q1'
                ? 'bg-blue-600 border-blue-500 text-white shadow-md'
                : 'bg-slate-800/70 border-slate-700 text-slate-300'
            }`}
          >
            Quincena 1 (1-15)
          </button>
          <button
            type="button"
            onClick={() => setCutoffMode('q2')}
            className={`py-2.5 px-2 rounded-xl text-xs font-black border transition-all ${
              cutoffMode === 'q2'
                ? 'bg-blue-600 border-blue-500 text-white shadow-md'
                : 'bg-slate-800/70 border-slate-700 text-slate-300'
            }`}
          >
            Quincena 2 (16-Fin)
          </button>
          <button
            type="button"
            onClick={() => setCutoffMode('custom')}
            className={`py-2.5 px-2 rounded-xl text-xs font-black border transition-all ${
              cutoffMode === 'custom'
                ? 'bg-blue-600 border-blue-500 text-white shadow-md'
                : 'bg-slate-800/70 border-slate-700 text-slate-300'
            }`}
          >
            Rango Libre
          </button>
        </div>

        {cutoffMode === 'custom' && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <label className="text-[10px] font-bold text-slate-400">DESDE</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full mt-0.5 rounded-xl px-2.5 py-1.5 text-xs font-bold bg-slate-800 border border-slate-700 text-white"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400">HASTA</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full mt-0.5 rounded-xl px-2.5 py-1.5 text-xs font-bold bg-slate-800 border border-slate-700 text-white"
              />
            </div>
          </div>
        )}

        {/* Selector de Doble Vista Financiera */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={() => setActiveTab('private')}
            className={`py-2.5 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 border ${
              activeTab === 'private'
                ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md'
                : 'bg-slate-800/60 text-slate-300 border-slate-700'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Control & Auditoría</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('sr_juan')}
            className={`py-2.5 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 border ${
              activeTab === 'sr_juan'
                ? 'bg-emerald-600 text-white border-emerald-400 shadow-md'
                : 'bg-slate-800/60 text-slate-300 border-slate-700'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Cuenta Cobro PDF</span>
          </button>
        </div>
      </div>

      {/* NUEVO MÓDULO: ⚖️ AUDITORÍA DE PAGO RECIBIDO (LO CALCULADO VS. LO PAGADO POR LA EMPRESA) */}
      <div
        className={`rounded-3xl border-2 p-4 shadow-xl space-y-3.5 ${
          highContrastSun
            ? 'bg-white border-indigo-600 text-slate-950'
            : 'bg-slate-900/95 border-indigo-500/60 text-slate-50'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-600 text-white">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black leading-tight">
                ⚖️ Auditoría de Pago Recibido
              </h3>
              <p className="text-[11px] text-slate-400">
                Compara tu cálculo en MiRuta vs. lo transferido por {employerName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSaveSettlementAudit}
            className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs flex items-center gap-1 shadow-md"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Guardar</span>
          </button>
        </div>

        {settlementSavedMsg && (
          <div className="p-2 rounded-xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold text-center">
            {settlementSavedMsg}
          </div>
        )}

        {/* Comparativa Lado a Lado: Columna A vs Columna B */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Columna A: Mi Cálculo Neto en App */}
          <div
            className={`p-3 rounded-2xl border ${
              highContrastSun
                ? 'bg-slate-50 border-slate-300'
                : 'bg-slate-950/80 border-slate-800'
            }`}
          >
            <span className="text-[10px] font-black uppercase tracking-wider text-blue-400 block">
              COLUMNA A • MI CÁLCULO NETO EN APP
            </span>
            <p className="text-xl font-black font-mono mt-1 text-emerald-400">
              {formatCOP(expectedNetFromCompany, true)}
            </p>
            <div className="mt-1.5 text-[11px] text-slate-400 space-y-0.5 font-semibold">
              <p>• Entregas verificadas: {deliveredPackages.length} paq.</p>
              <p>• Bruto entregas: {formatCOP(grossIncome)}</p>
              <p>• Descuentos/Multas: -{formatCOP(totalDeductionsCOP)}</p>
            </div>
          </div>

          {/* Columna B: Lo que Pagó la Empresa / Sr. Juan */}
          <div
            className={`p-3 rounded-2xl border ${
              highContrastSun
                ? 'bg-slate-50 border-slate-300'
                : 'bg-slate-950/80 border-slate-800'
            }`}
          >
            <label className="text-[10px] font-black uppercase tracking-wider text-amber-400 block">
              COLUMNA B • LO QUE PAGÓ LA EMPRESA ($ COP)
            </label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-amber-400">
                $
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={actualPaidInput}
                onChange={(e) => setActualPaidInput(formatLiveCOPInput(e.target.value))}
                placeholder={`Ej: ${formatLiveCOPInput(String(expectedNetFromCompany))}`}
                className={`w-full rounded-xl pl-7 pr-3 py-2 text-base font-black font-mono border focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  highContrastSun
                    ? 'bg-white border-slate-300 text-slate-950'
                    : 'bg-slate-900 border-slate-700 text-white'
                }`}
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5 mt-2">
              <div>
                <label className="text-[10px] font-bold text-slate-400 block">
                  PAQ. SEGÚN EMPRESA
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={reportedPkgsInput}
                  onChange={(e) => setReportedPkgsInput(e.target.value)}
                  placeholder={`${deliveredPackages.length}`}
                  className={`w-full mt-0.5 rounded-lg px-2 py-1 text-xs font-bold border ${
                    highContrastSun
                      ? 'bg-white border-slate-300 text-slate-950'
                      : 'bg-slate-900 border-slate-700 text-white'
                  }`}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 block">
                  MEDIO DE PAGO
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethodType)}
                  className={`w-full mt-0.5 rounded-lg px-2 py-1 text-xs font-bold border ${
                    highContrastSun
                      ? 'bg-white border-slate-300 text-slate-950'
                      : 'bg-slate-900 border-slate-700 text-white'
                  }`}
                >
                  <option value="Nequi">Nequi</option>
                  <option value="Bancolombia">Bancolombia</option>
                  <option value="Efectivo">Efectivo</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Diagnóstico Automático de Diferencia */}
        {hasEnteredPaidAmount && (
          <div className="space-y-2">
            {paymentDiff === 0 && (
              <div className="p-3 rounded-2xl bg-emerald-950/70 border-2 border-emerald-500/60 text-emerald-200 text-xs font-bold leading-relaxed">
                🟢 <strong>CUENTA EXACTA ($0 de diferencia):</strong> ✅ Liquidación exacta. El pago recibido por {paymentMethod} coincide al 100% con tus {deliveredPackages.length} paquetes entregados.
              </div>
            )}

            {paymentDiff < 0 && (
              <div className="p-3.5 rounded-2xl bg-rose-950/80 border-2 border-rose-500 text-rose-100 space-y-2.5">
                <div className="text-xs font-bold leading-relaxed">
                  🔴 <strong>FALTANTE DE DINERO ({formatCOP(paymentDiff, true)}):</strong> 🚨 Descuadre en contra: Te pagaron{' '}
                  <strong className="underline text-white">
                    {formatCOP(Math.abs(paymentDiff), true)}
                  </strong>{' '}
                  menos de lo calculado. A {formatCOP(defaultRate)}/paquete, esto equivale a{' '}
                  <strong className="text-amber-300">
                    {missingPkgsByCount > 0 ? missingPkgsByCount : missingPackagesEquivalent} paquetes entregados que no te están reconociendo
                  </strong>{' '}
                  (o un descuento no reportado).
                </div>

                <a
                  href={buildAuditDisputeWhatsAppUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2.5 px-3 rounded-xl bg-white text-rose-900 font-black text-xs flex items-center justify-center gap-2 shadow-md"
                >
                  <MessageSquareWarning className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>ENVIAR RECLAMO DE FALTANTE POR WHATSAPP AL {employerName.toUpperCase()}</span>
                </a>
              </div>
            )}

            {paymentDiff > 0 && (
              <div className="p-3 rounded-2xl bg-blue-950/70 border-2 border-blue-400/60 text-blue-100 text-xs font-bold leading-relaxed">
                🔵 <strong>SALDO A FAVOR (+{formatCOP(paymentDiff, true)}):</strong> 💎 Te transfirieron {formatCOP(paymentDiff, true)} adicionales sobre el neto calculado (bonificación o ajuste positivo).
              </div>
            )}
          </div>
        )}

        {/* Botón Copiloto IA: 🧠 Redactar Sustento de Cobro / Reclamo con IA */}
        <div className="pt-1 space-y-2.5">
          <button
            type="button"
            disabled={isDraftingClaim}
            onClick={handleGenerateAIClaimDraft}
            className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-teal-600 hover:from-indigo-500 hover:to-teal-500 text-white font-black text-xs flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all"
          >
            {isDraftingClaim ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-amber-300 shrink-0" />
                <span>REDACTANDO SUSTENTO FORMAL CON IA...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
                <span>🧠 REDACTAR SUSTENTO DE COBRO / RECLAMO CON IA</span>
              </>
            )}
          </button>

          {aiClaimDraft && (
            <div className="p-3.5 rounded-2xl bg-slate-950/95 border-2 border-indigo-500/60 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-indigo-300 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  Sustento Formal Redactado por IA (Editable)
                </span>
                <button
                  type="button"
                  onClick={() => setAiClaimDraft('')}
                  className="text-[10px] font-bold text-slate-400 hover:text-white"
                >
                  Cerrar
                </button>
              </div>

              <textarea
                rows={6}
                value={aiClaimDraft}
                onChange={(e) => setAiClaimDraft(e.target.value)}
                className="w-full rounded-xl p-2.5 text-xs font-medium bg-slate-900 border border-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(aiClaimDraft);
                    toast.success('📋 Sustento copiado al portapapeles');
                  }}
                  className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-black text-xs flex items-center justify-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Copiar Texto</span>
                </button>

                <a
                  href={`https://wa.me/?text=${encodeURIComponent(aiClaimDraft)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-md"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Enviar al {employerName}</span>
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SECCIÓN DE PENALIZACIONES, MULTAS Y DESCUENTOS */}
      <div
        className={`rounded-3xl border p-4 shadow-lg space-y-3 ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-950'
            : 'bg-slate-900/95 border-slate-800 text-slate-50'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black flex items-center gap-1.5 text-rose-400">
              <AlertOctagon className="w-4 h-4" />
              <span>Penalizaciones, Multas y Adelantos</span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Control de sanciones operativas iMile o adelantos de nómina
            </p>
          </div>
        </div>

        {/* Botones Rápidos de Penalizaciones Oficiales */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() =>
              handleQuickAddPenalty('lost_package', 'Paquete Perdido / Extraviado', 120000)
            }
            className="p-2.5 rounded-2xl bg-rose-950/50 hover:bg-rose-900/60 border border-rose-500/40 text-left transition-all active:scale-[0.99]"
          >
            <span className="text-xs font-black text-rose-300 block">
              📦 Paquete Perdido (-$120.000 COP)
            </span>
            <span className="text-[11px] font-semibold text-slate-400">
              Equivale a entregar <strong>{lostPkgEquivalent} paquetes</strong> a {formatCOP(defaultRate)}
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              handleQuickAddPenalty(
                'fake_signature',
                'Firma Falsificada / Sanción Grave',
                600000
              )
            }
            className="p-2.5 rounded-2xl bg-rose-950/70 hover:bg-rose-900/80 border border-rose-500/60 text-left transition-all active:scale-[0.99]"
          >
            <span className="text-xs font-black text-rose-200 block">
              ✍️ Firma Falsificada / Sanción (-$600.000 COP)
            </span>
            <span className="text-[11px] font-semibold text-slate-400">
              Equivale a entregar <strong>{fakeSigEquivalent} paquetes</strong> a {formatCOP(defaultRate)}
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowDiscountModal(true)}
          className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-black text-xs flex items-center justify-center gap-1.5"
        >
          <PlusCircle className="w-4 h-4 text-amber-400" />
          <span>➕ Agregar Otro Descuento / Adelanto Manual</span>
        </button>

        {/* Lista de Descuentos Registrados en la Quincena */}
        {filteredDeductions.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {filteredDeductions.map((ded) => (
              <div
                key={ded.id}
                className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-black text-rose-300 truncate">
                    {ded.title} (-{formatCOP(ded.amount, true)})
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {ded.date} {ded.trackingNumber ? `• Guía: ${ded.trackingNumber}` : ''}{' '}
                    {ded.notes ? `• ${ded.notes}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleDeductionPdf(ded.id, ded.applyToJuanPdf)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-black border ${
                      ded.applyToJuanPdf
                        ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                  >
                    {ded.applyToJuanPdf ? 'En PDF: SÍ' : 'Solo Privado'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteDeduction(ded.id)}
                    className="p-1.5 rounded-lg bg-slate-800 text-rose-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* VISTA 1: VISTA PRIVADA DE BOLSILLO (SOLO PARA CHRISTIAN) */}
      {activeTab === 'private' && (
        <div
          className={`rounded-3xl border p-4 shadow-lg space-y-3 ${
            highContrastSun
              ? 'bg-white border-slate-300 text-slate-950'
              : 'bg-slate-900/95 border-slate-800 text-slate-50'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" />
              RENTABILIDAD REAL PRIVADA (DESCONTANDO GASOLINA)
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
              <span className="text-[11px] font-bold text-slate-400">BRUTO ENTREGAS</span>
              <p className="text-lg font-black text-white mt-0.5">{formatCOP(grossIncome)}</p>
              <span className="text-[11px] font-semibold text-emerald-400">
                {deliveredPackages.length} paq. entregados
              </span>
            </div>

            <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                <Fuel className="w-3.5 h-3.5 text-amber-400" />
                GASOLINA + MULTAS
              </span>
              <p className="text-lg font-black text-rose-400 mt-0.5">
                - {formatCOP(totalFuelQuincena + totalDeductionsCOP)}
              </p>
              <span className="text-[11px] text-slate-400">
                Gas: {formatCOP(totalFuelQuincena)} | Dctos: {formatCOP(totalDeductionsCOP)}
              </span>
            </div>

            <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-blue-400" />
                PROMEDIO REAL / HORA
              </span>
              <p className="text-lg font-black text-blue-400 mt-0.5">
                {formatCOP(realNetPerHour)}/h
              </p>
              <span className="text-[11px] text-slate-400">
                ~{totalHoursQuincena.toFixed(1)} h efectivas
              </span>
            </div>

            <div className="p-3 rounded-2xl bg-emerald-950/50 border-2 border-emerald-500/50">
              <span className="text-[11px] font-extrabold text-emerald-300 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" />
                GANANCIA LIBRE BOLSILLO
              </span>
              <p className="text-xl font-black text-emerald-400 mt-0.5">
                {formatCOP(netFreePocketProfit)}
              </p>
              <span className="text-[11px] font-bold text-emerald-200">
                Libre tras gasolina y descuentos
              </span>
            </div>
          </div>
        </div>
      )}

      {/* VISTA 2: DOCUMENTO FORMAL Y EXPORTACIÓN PDF PARA EL SR. JUAN */}
      <div
        className={`rounded-3xl border p-4 shadow-xl space-y-3.5 ${
          highContrastSun
            ? 'bg-white border-emerald-600 text-slate-950'
            : 'bg-slate-900 border-emerald-500/60 text-slate-50'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              MI RUTA BY CHRISTIAN ROMERO • CUENTA DE COBRO
            </span>
            <h3 className="text-sm font-black mt-1">
              RELACIÓN QUINCENAL DE PAQUETES ENTREGADOS - OPERACIÓN IMILE
            </h3>
          </div>
          <FileText className="w-6 h-6 text-emerald-400 shrink-0" />
        </div>

        <div className="p-2.5 rounded-xl bg-blue-950/60 border border-blue-500/30 flex items-center gap-2 text-[11px] font-semibold text-blue-200">
          <ShieldAlert className="w-4 h-4 text-blue-400 shrink-0" />
          <span>
            Privacidad Blindada: El PDF para el {employerName} <strong>JAMÁS</strong> incluye tus gastos de gasolina, horas trabajadas ni alertas del semáforo.
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-slate-400">CONTRATISTA</label>
            <input
              type="text"
              value={contractorName}
              onChange={(e) => setContractorName(e.target.value)}
              className={`w-full mt-0.5 rounded-xl px-2.5 py-1.5 text-xs font-bold border ${
                highContrastSun
                  ? 'bg-slate-50 border-slate-300 text-slate-950'
                  : 'bg-slate-950 border-slate-800 text-white'
              }`}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400">CONTRATANTE</label>
            <input
              type="text"
              value={employerName}
              onChange={(e) => setEmployerName(e.target.value)}
              className={`w-full mt-0.5 rounded-xl px-2.5 py-1.5 text-xs font-bold border ${
                highContrastSun
                  ? 'bg-slate-50 border-slate-300 text-slate-950'
                  : 'bg-slate-950 border-slate-800 text-white'
              }`}
            />
          </div>
        </div>

        {/* Tabla Resumen por Día */}
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-800 text-slate-200 font-black text-[11px]">
                <th className="py-2 px-2.5">Fecha</th>
                <th className="py-2 px-2 text-center">Entregados</th>
                <th className="py-2 px-2 text-center">Novedad</th>
                <th className="py-2 px-2.5 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {dailySummary.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-slate-400 font-semibold">
                    Sin entregas registradas en este corte quincenal
                  </td>
                </tr>
              ) : (
                dailySummary.map(([dateKey, row]) => (
                  <tr key={dateKey} className="font-bold">
                    <td className="py-2 px-2.5 font-mono">{dateKey}</td>
                    <td className="py-2 px-2 text-center text-emerald-400">{row.delivered}</td>
                    <td className="py-2 px-2 text-center text-rose-400">{row.issues}</td>
                    <td className="py-2 px-2.5 text-right font-mono">{formatCOP(row.subtotal)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Gran Total a Pagar */}
        <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-green-600 text-white flex items-center justify-between shadow-lg">
          <div>
            <span className="text-[11px] font-black uppercase block opacity-90">
              GRAN TOTAL A COBRAR ({deliveredPackages.length} PAQ.)
            </span>
            <span className="text-xs font-semibold opacity-90">
              Generado por MiRuta by Christian Romero
            </span>
          </div>
          <span className="text-xl font-black font-mono">
            {formatCOP(
              Math.max(
                0,
                grossIncome -
                  filteredDeductions
                    .filter((d) => d.applyToJuanPdf)
                    .reduce((s, d) => s + d.amount, 0)
              ),
              true
            )}
          </span>
        </div>

        {/* Botones de Exportación y Envío por WhatsApp al Sr. Juan */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          <button
            type="button"
            disabled={generatingPdf}
            onClick={() => handleExportPDF('share')}
            className="py-3.5 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 active:scale-95"
          >
            <Share2 className="w-4 h-4 shrink-0" />
            <span>ENVIAR PDF AL WHATSAPP DEL {employerName.toUpperCase()}</span>
          </button>

          <button
            type="button"
            disabled={generatingPdf}
            onClick={() => handleExportPDF('download')}
            className="py-3.5 px-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25 active:scale-95"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>DESCARGAR CUENTA DE COBRO PDF</span>
          </button>
        </div>

        {deliveredPackages.length > 0 && (
          <div className="pt-2">
            <p className="text-[11px] font-extrabold text-slate-400 uppercase mb-1.5 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Anexo Verificable de Guías Entregadas ({deliveredPackages.length})
            </p>
            <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
              {deliveredPackages.map((pkg, i) => (
                <div
                  key={pkg.id ?? pkg.trackingNumber}
                  className="text-[11px] font-mono px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-2"
                >
                  <span className="truncate">
                    <strong>{i + 1}.</strong> {pkg.trackingNumber} (<strong>#{pkg.lastFourDigits}</strong>) - {pkg.rawAddress}
                  </span>
                  <span className="text-emerald-400 shrink-0">
                    {pkg.deliveredAt
                      ? new Date(pkg.deliveredAt).toLocaleTimeString('es-CO', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : 'OK'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modal para Agregar Descuento / Adelanto Manual */}
      {showDiscountModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-2 sm:p-4 touch-scroll-y">
          <form
            onSubmit={handleSaveManualDiscount}
            className={`w-full max-w-md rounded-3xl border p-4 pb-8 space-y-3 max-h-[88dvh] touch-scroll-y my-auto ${
              highContrastSun
                ? 'bg-white border-slate-300 text-slate-950'
                : 'bg-slate-900 border-slate-800 text-slate-100'
            }`}
          >
            <h3 className="text-base font-black text-amber-400">
              ➕ Registrar Descuento o Adelanto Manual
            </h3>

            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1">
                TIPO DE DESCUENTO
              </label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as DeductionType)}
                className="w-full rounded-xl px-3 py-2 text-xs font-bold bg-slate-950 border border-slate-700 text-white"
              >
                <option value="advance_payment">Adelanto de Nómina /Efectivo</option>
                <option value="manual_discount">Descuento Manual / Ajuste</option>
                <option value="lost_package">Paquete Perdido</option>
                <option value="fake_signature">Sanción Firma</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1">
                CONCEPTO / TÍTULO *
              </label>
              <input
                type="text"
                required
                value={discountTitle}
                onChange={(e) => setDiscountTitle(e.target.value)}
                placeholder="Ej: Adelanto gasolina Sr. Juan / Descuento guía"
                className="w-full rounded-xl px-3 py-2 text-xs font-bold bg-slate-950 border border-slate-700 text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">
                  VALOR ($ COP) *
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-black text-emerald-400">
                    $
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(formatLiveCOPInput(e.target.value))}
                    placeholder="50.000"
                    className="w-full rounded-xl pl-6 pr-3 py-2 text-xs font-bold font-mono bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">
                  GUÍA (OPCIONAL)
                </label>
                <input
                  type="text"
                  value={discountTracking}
                  onChange={(e) => setDiscountTracking(e.target.value)}
                  placeholder="610302..."
                  className="w-full rounded-xl px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-700 text-white"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1">
                OBSERVACIONES
              </label>
              <input
                type="text"
                value={discountNotes}
                onChange={(e) => setDiscountNotes(e.target.value)}
                placeholder="Nota adicional..."
                className="w-full rounded-xl px-3 py-2 text-xs bg-slate-950 border border-slate-700 text-white"
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-bold cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={discountApplyPdf}
                onChange={(e) => setDiscountApplyPdf(e.target.checked)}
                className="rounded"
              />
              <span>Incluir este descuento dentro del PDF para el {employerName}</span>
            </label>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-black text-xs"
              >
                Guardar Descuento
              </button>
              <button
                type="button"
                onClick={() => setShowDiscountModal(false)}
                className="py-3 px-4 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
