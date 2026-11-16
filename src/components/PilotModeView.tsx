import React, { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Navigation,
  Map,
  MessageCircle,
  PhoneCall,
  CheckCircle2,
  AlertTriangle,
  Timer,
  Camera,
  BellRing,
  PackageCheck,
  Sparkles,
  ArrowRight,
  Play,
  Pause,
  Flag,
  RotateCcw,
  Fuel,
  Coffee,
  Package as PkgIcon,
  X,
  Copy
} from 'lucide-react';
import {
  db,
  type DeliveryPackage,
  getDefaultPackageRate,
  ensureShiftExists,
  getTodayShiftId,
  closeActiveShift,
  type PendingPackagesAction
} from '../db/database';
import {
  playCashRegisterSuccess,
  compressProofPhotoToBase64,
  buildWhatsAppPreNoticeUrl,
  buildArrivalWhatsAppUrl,
  buildNavigationLinks,
  formatCOP
} from '../utils/mediaAndFeedback';
import { detectSameBlockClusters } from '../utils/addressParser';
import { syncToSupabase } from '../services/supabaseSync';
import { PackageSizeBadge } from './PackageSizeBadge';
import { useToast } from './ui/FeedbackSystem';
import { PackageDetailsModal } from './PackageDetailsModal';

interface PilotModeViewProps {
  packages: DeliveryPackage[];
  highContrastSun: boolean;
  onOpenScanner: () => void;
}

export const PilotModeView: React.FC<PilotModeViewProps> = ({
  packages,
  highContrastSun,
  onOpenScanner
}) => {
  const toast = useToast();
  const [now, setNow] = useState<number>(Date.now());
  const [showIssueModal, setShowIssueModal] = useState<boolean>(false);
  const [issueReason, setIssueReason] = useState<string>('Cliente no contesta tras 5 min');
  const [uploadingPhoto, setUploadingPhoto] = useState<boolean>(false);
  const [nextClientAlertPkg, setNextClientAlertPkg] = useState<DeliveryPackage | null>(null);
  const [showArrivalActions, setShowArrivalActions] = useState<boolean>(false);
  const [showDetailsModal, setShowDetailsModal] = useState<boolean>(false);

  // Control de Jornada v8.6 (Inicio, Pausas Inteligentes y Cierre)
  const todayShiftId = getTodayShiftId();
  const shift = useLiveQuery(() => db.shifts.get(todayShiftId), [todayShiftId]);
  const [showPauseMenu, setShowPauseMenu] = useState<boolean>(false);
  const [showCloseShiftModal, setShowCloseShiftModal] = useState<boolean>(false);
  const [closingFuelInput, setClosingFuelInput] = useState<string>('12.000');
  const [closingPendingAction, setClosingPendingAction] = useState<PendingPackagesAction>('move_to_tomorrow');
  const [isClosingShift, setIsClosingShift] = useState<boolean>(false);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const defaultRate = getDefaultPackageRate();

  // Solo mostrar en la cola activa los paquetes no archivados
  const activeQueue = [...packages]
    .filter((p) => !p.archivedInHistory && (p.status === 'pending' || p.status === 'in_progress'))
    .sort((a, b) => (a.routeOrder || 0) - (b.routeOrder || 0));

  const currentPkg = activeQueue[0] || null;
  const nextPkg = activeQueue[1] || null;

  const sameBlockAlerts = detectSameBlockClusters(activeQueue);
  const currentSameBlock = currentPkg
    ? sameBlockAlerts.find((a) => a.blockKey === currentPkg.parsedAddress?.blockKey)
    : undefined;

  const doorWaitSeconds =
    currentPkg && currentPkg.arrivedAtPointAt
      ? Math.max(0, Math.floor((now - currentPkg.arrivedAtPointAt) / 1000))
      : 0;
  const isOverThreeMinutes = doorWaitSeconds >= 180;

  const formatStopwatch = (ms: number) => {
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const isShiftActive = shift?.status === 'active' && !shift?.isPaused && !!shift?.startedAt;
  const isShiftPaused = !!shift?.isPaused && !!shift?.startedAt && shift?.status !== 'closed';
  const isShiftNotStarted = !shift?.startedAt || shift?.status === 'closed';

  const activeDurationMs = useMemo(() => {
    if (!shift?.startedAt) return 0;
    if (shift.status === 'closed') return shift.effectiveDurationMs || 0;
    const baseEnd = isShiftPaused && shift.lastPauseStartedAt ? shift.lastPauseStartedAt : now;
    return Math.max(0, baseEnd - shift.startedAt - (shift.accumulatedPausedMs || 0));
  }, [shift, now, isShiftPaused]);

  const currentPauseMs = useMemo(() => {
    if (!isShiftPaused || !shift?.lastPauseStartedAt) return 0;
    return Math.max(0, now - shift.lastPauseStartedAt);
  }, [isShiftPaused, shift?.lastPauseStartedAt, now]);

  const totalPausedMs = (shift?.accumulatedPausedMs || 0) + (isShiftPaused ? currentPauseMs : 0);

  const deliveredPkgs = packages.filter((p) => p.status === 'delivered');
  const deliveredCount = deliveredPkgs.length;
  const grossEarnedCOP = deliveredPkgs.reduce((acc, p) => acc + (p.rate || defaultRate), 0);

  const activeHours = activeDurationMs / 3600000;
  const paceNumeric = activeHours >= 0.05
    ? Number((deliveredCount / activeHours).toFixed(1))
    : (deliveredCount > 0 ? Number(deliveredCount.toFixed(1)) : 0);
  const pacePerHour = paceNumeric.toFixed(1);

  const handleStartShift = async () => {
    const s = await ensureShiftExists(todayShiftId);
    await db.shifts.update(s.id, {
      status: 'active',
      startedAt: Date.now(),
      endTime: null,
      isPaused: false,
      lastPauseStartedAt: null,
      accumulatedPausedMs: 0,
      pauseReason: undefined
    });
    playCashRegisterSuccess();
    toast.success('🚀 ¡Jornada Iniciada!', 'Cronómetro activo y contador de paq/h en marcha.');
  };

  const handlePauseShift = async (reason: string) => {
    const s = await ensureShiftExists(todayShiftId);
    await db.shifts.update(s.id, {
      status: 'paused',
      isPaused: true,
      lastPauseStartedAt: Date.now(),
      pauseReason: reason
    });
    setShowPauseMenu(false);
    toast.warning(`⏸️ Jornada en Pausa (${reason})`, 'Tiempo activo congelado para no distorsionar tu ritmo de entrega.');
  };

  const handleResumeShift = async () => {
    const s = await ensureShiftExists(todayShiftId);
    const pauseDelta = s.lastPauseStartedAt ? Date.now() - s.lastPauseStartedAt : 0;
    await db.shifts.update(s.id, {
      status: 'active',
      isPaused: false,
      lastPauseStartedAt: null,
      accumulatedPausedMs: (s.accumulatedPausedMs || 0) + pauseDelta,
      pauseReason: undefined
    });
    playCashRegisterSuccess();
    toast.success('▶️ ¡Ruta Reanudada!', 'Cronómetro de entregas reactivado.');
  };

  const handleConfirmCloseShift = async () => {
    setIsClosingShift(true);
    try {
      const fuelNum = parseInt(closingFuelInput.replace(/\D/g, ''), 10) || 12000;
      await closeActiveShift({
        shiftId: todayShiftId,
        fuelExpense: fuelNum,
        pendingAction: closingPendingAction,
        effectiveDurationMs: activeDurationMs
      });
      setShowCloseShiftModal(false);
      toast.success(
        '🏁 Jornada Cerrada con Éxito',
        `Entregaste ${deliveredCount} paquetes hoy. Backup local generado automáticamente.`
      );
    } catch {
      toast.error('Error al cerrar la jornada');
    } finally {
      setIsClosingShift(false);
    }
  };

  const activateShiftIfWaiting = async () => {
    const s = await ensureShiftExists(getTodayShiftId());
    if (!s.startedAt || s.status === 'closed') {
      await db.shifts.update(s.id, {
        status: 'active',
        startedAt: s.startedAt || Date.now(),
        endTime: null,
        isPaused: false,
        lastPauseStartedAt: null
      });
    } else if (s.isPaused) {
      const pauseDelta = s.lastPauseStartedAt ? Date.now() - s.lastPauseStartedAt : 0;
      await db.shifts.update(s.id, {
        status: 'active',
        isPaused: false,
        lastPauseStartedAt: null,
        accumulatedPausedMs: (s.accumulatedPausedMs || 0) + pauseDelta
      });
    }
  };

  const handleStartDoorTimer = async () => {
    if (!currentPkg || currentPkg.id === undefined) return;
    await activateShiftIfWaiting();
    await db.packages.update(currentPkg.id, {
      status: 'in_progress',
      arrivedAtPointAt: Date.now()
    });
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(50);
    }
  };

  const handleArrivedAtPoint = async () => {
    if (!currentPkg || currentPkg.id === undefined) return;
    await activateShiftIfWaiting();
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([60, 40, 60]);
    }
    if (!currentPkg.arrivedAtPointAt) {
      await db.packages.update(currentPkg.id, {
        status: 'in_progress',
        arrivedAtPointAt: Date.now()
      });
      toast.info('⏱️ Cronómetro de Puerta Iniciado', 'Límite sugerido: 3 minutos.');
    }
    setShowArrivalActions((prev) => !prev);
  };

  const handleCopyAddress = async (addr: string) => {
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
      toast.success('✅ Dirección copiada al portapapeles', addr);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(40);
      }
    } catch {
      toast.info('📋 Dirección seleccionada', addr);
    }
  };

  const handleResetDoorTimer = async () => {
    if (!currentPkg || currentPkg.id === undefined) return;
    await db.packages.update(currentPkg.id, {
      arrivedAtPointAt: undefined
    });
  };

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentPkg || currentPkg.id === undefined) return;
    try {
      setUploadingPhoto(true);
      const compressedBase64 = await compressProofPhotoToBase64(file);
      await db.packages.update(currentPkg.id, {
        proofPhotoBase64: compressedBase64
      });
      toast.success(
        `📸 Evidencia guardada (#${currentPkg.lastFourDigits})`,
        'Comprimida a <80KB en tu bóveda local.'
      );
    } catch {
      toast.error('⚠️ No se pudo comprimir la foto de respaldo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const captureCurrentGPSOrFallback = (
    pkg: DeliveryPackage
  ): Promise<{ lat: number; lng: number } | null> => {
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(pkg.coordinates || null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: Number(pos.coords.latitude.toFixed(6)),
            lng: Number(pos.coords.longitude.toFixed(6))
          });
        },
        () => {
          resolve(pkg.coordinates || null);
        },
        { enableHighAccuracy: true, timeout: 1800, maximumAge: 30000 }
      );
    });
  };

  const handleMarkDelivered = async () => {
    if (!currentPkg || currentPkg.id === undefined) return;
    const pkgId = currentPkg.id;
    const candidateNext = nextPkg || null;
    const finalWaitSecs = currentPkg.arrivedAtPointAt
      ? Math.max(0, Math.floor((Date.now() - currentPkg.arrivedAtPointAt) / 1000))
      : 0;

    await activateShiftIfWaiting();
    playCashRegisterSuccess();

    // Guardar en IndexedDB en 0ms de forma instantánea con coordenadas estimadas iniciales
    await db.packages.update(pkgId, {
      status: 'delivered',
      rate: currentPkg.rate || defaultRate,
      deliveredAt: Date.now(),
      waitTimeSeconds: finalWaitSecs,
      deliveryCoordinates: currentPkg.coordinates || null
    });

    toast.success(
      `✅ Paquete #${currentPkg.lastFourDigits} entregado (+${formatCOP(currentPkg.rate || defaultRate)})`,
      currentPkg.rawAddress
    );

    if (candidateNext) {
      setNextClientAlertPkg(candidateNext);
    } else {
      setNextClientAlertPkg(null);
    }

    // Refinar en segundo plano (Fire-and-forget, 100% offline-first)
    setTimeout(() => {
      captureCurrentGPSOrFallback(currentPkg).then(async (exactCoords) => {
        if (exactCoords) {
          await db.packages.update(pkgId, { deliveryCoordinates: exactCoords });
        }
        syncToSupabase(true).catch(() => {});
      }).catch(() => {});
    }, 0);
  };

  const handleMarkIssue = async () => {
    if (!currentPkg || currentPkg.id === undefined) return;
    const candidateNext = nextPkg || null;
    const finalWaitSecs = currentPkg.arrivedAtPointAt
      ? Math.max(0, Math.floor((Date.now() - currentPkg.arrivedAtPointAt) / 1000))
      : 0;

    await activateShiftIfWaiting();
    await db.packages.update(currentPkg.id, {
      status: 'issue',
      issueNote: issueReason,
      deliveredAt: Date.now(),
      waitTimeSeconds: finalWaitSecs
    });
    setShowIssueModal(false);
    toast.warning(
      `⚠️ Novedad registrada en #${currentPkg.lastFourDigits}`,
      issueReason
    );

    if (candidateNext) {
      setNextClientAlertPkg(candidateNext);
    }
    setTimeout(() => {
      syncToSupabase(true).catch(() => {});
    }, 0);
  };

  const renderShiftControlCard = () => {
    if (isShiftNotStarted) {
      return (
        <div className="p-3.5 rounded-3xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white shadow-xl border-2 border-emerald-400">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider bg-black/25 px-2 py-0.5 rounded-full">
                🏍️ CONTROL DE JORNADA
              </span>
              <h3 className="text-sm font-black mt-1">
                {shift?.status === 'closed' ? '🏁 Jornada de Hoy Finalizada' : 'Jornada no iniciada'}
              </h3>
              <p className="text-xs text-emerald-100">
                Inicia el cronómetro para registrar tu tiempo real y paq/hora.
              </p>
            </div>

            <button
              type="button"
              onClick={handleStartShift}
              className="py-3 px-4 rounded-2xl bg-white hover:bg-emerald-50 text-emerald-950 font-black text-xs sm:text-sm flex items-center gap-1.5 shadow-lg active:scale-95 transition-all shrink-0 cursor-pointer"
            >
              <Play className="w-5 h-5 fill-emerald-600 text-emerald-600 shrink-0" />
              <span>▶ EMPEZAR JORNADA</span>
            </button>
          </div>
        </div>
      );
    }

    if (isShiftPaused) {
      return (
        <div className="p-3.5 rounded-3xl bg-amber-950/90 border-2 border-amber-500 text-amber-100 shadow-xl space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-2xl shrink-0">⏸️</span>
              <div className="min-w-0">
                <h3 className="text-sm font-black text-amber-300 truncate">
                  JORNADA EN PAUSA ({shift?.pauseReason || 'Pausa Operativa'})
                </h3>
                <p className="text-[11px] text-amber-200/80 leading-snug">
                  Tiempo activo detenido. En pausa:{' '}
                  <strong className="font-mono text-white text-xs">
                    {formatStopwatch(currentPauseMs)}
                  </strong>
                </p>
              </div>
            </div>

            <span className="text-[10px] font-mono font-bold bg-amber-500/20 border border-amber-500/40 text-amber-300 px-2 py-0.5 rounded-lg shrink-0">
              Pausas: {Math.round(totalPausedMs / 60000)} min
            </span>
          </div>

          <button
            type="button"
            onClick={handleResumeShift}
            className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 via-emerald-600 to-green-600 hover:from-emerald-400 hover:to-green-500 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all cursor-pointer"
          >
            <Play className="w-4 h-4 fill-slate-950 text-slate-950 shrink-0" />
            <span>▶ REANUDAR RUTA</span>
          </button>
        </div>
      );
    }

    // Jornada Activa
    return (
      <div
        className={`p-3.5 rounded-3xl border-2 shadow-xl space-y-2.5 ${
          highContrastSun
            ? 'bg-white border-blue-600 text-slate-950'
            : 'bg-slate-900 border-blue-500/70 text-slate-100'
        }`}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-black text-emerald-400">
              JORNADA EN CURSO
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="text-right">
              <span className="text-[9px] text-slate-400 block uppercase font-bold">Tiempo Activo</span>
              <span className="text-base sm:text-lg font-black font-mono text-emerald-400 leading-none">
                {formatStopwatch(activeDurationMs)}
              </span>
            </div>
            <div className="text-right border-l border-slate-700 pl-2.5">
              <span className="text-[9px] text-slate-400 block uppercase font-bold">Ritmo</span>
              <span className="text-xs sm:text-sm font-black font-mono text-amber-400 leading-none">
                {pacePerHour} paq/h
              </span>
            </div>
          </div>
        </div>

        {/* Botones de Control: Pausas y Terminar */}
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800">
          <button
            type="button"
            onClick={() => setShowPauseMenu(!showPauseMenu)}
            className="py-2 px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-black text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer"
          >
            <Pause className="w-3.5 h-3.5" />
            <span>⏸️ Pausar Jornada</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCloseShiftModal(true)}
            className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-black text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer"
          >
            <Flag className="w-3.5 h-3.5 text-rose-400" />
            <span>🏁 Terminar Jornada</span>
          </button>
        </div>

        {/* Menú Rápido de Motivos de Pausa */}
        {showPauseMenu && (
          <div className="p-2.5 rounded-2xl bg-slate-950 border border-amber-500/40 space-y-1.5">
            <span className="text-[10px] font-bold text-amber-400 block">
              Selecciona motivo de pausa (congela el cronómetro para no distorsionar paq/h):
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => handlePauseShift('Almuerzo')}
                className="py-2 px-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-amber-200 text-center flex flex-col items-center gap-0.5 active:scale-95 cursor-pointer"
              >
                <span className="text-sm">🍔</span>
                <span>Almuerzo</span>
              </button>
              <button
                type="button"
                onClick={() => handlePauseShift('Gasolina / Moto')}
                className="py-2 px-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-amber-200 text-center flex flex-col items-center gap-0.5 active:scale-95 cursor-pointer"
              >
                <span className="text-sm">⛽</span>
                <span>Gasolina</span>
              </button>
              <button
                type="button"
                onClick={() => handlePauseShift('Espera Bodega')}
                className="py-2 px-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-amber-200 text-center flex flex-col items-center gap-0.5 active:scale-95 cursor-pointer"
              >
                <span className="text-sm">📦</span>
                <span>Espera Bodega</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderCloseShiftModal = () => {
    const effectiveHours = activeDurationMs / 3600000;
    const paceDecimal = effectiveHours >= 0.05
      ? Number((deliveredCount / effectiveHours).toFixed(1))
      : (deliveredCount > 0 ? Number(deliveredCount.toFixed(1)) : 0);

    let evalColor = highContrastSun
      ? 'bg-rose-100 border-2 border-rose-600 text-rose-950'
      : 'bg-rose-950/90 border-2 border-rose-500 text-rose-200';
    let evalText =
      '⚠️ Ritmo Bajo. Hoy la calle estuvo pesada y el tiempo no rindió. Descansa y enfócate en tu desarrollo; mañana ajustamos la ruta o recuperamos terreno el fin de semana.';

    if (paceDecimal >= 6.5) {
      evalColor = highContrastSun
        ? 'bg-emerald-100 border-2 border-emerald-600 text-emerald-950'
        : 'bg-emerald-950/90 border-2 border-emerald-500 text-emerald-200';
      evalText =
        '✅ Jornada Óptima (Modo Part-Time). Lograste un excelente ritmo de noche. Mantén este paso en la semana y complementa el fin de semana, vas perfecto para los $600.000 COP.';
    } else if (paceDecimal >= 4.5) {
      evalColor = highContrastSun
        ? 'bg-amber-100 border-2 border-amber-600 text-amber-950'
        : 'bg-amber-950/90 border-2 border-amber-500 text-amber-200';
      evalText =
        '🟡 Jornada Regular. Hubo algunas demoras, pero salvaste el turno. Recuerda usar los mensajes de WhatsApp rápido para no perder minutos esperando en puerta.';
    }

    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 p-3 sm:p-4 touch-scroll-y">
        <div
          className={`w-full max-w-md rounded-3xl border p-5 space-y-3.5 max-h-[90dvh] touch-scroll-y my-auto shadow-2xl ${
            highContrastSun
              ? 'bg-white border-slate-300 text-slate-950'
              : 'bg-slate-900 border-slate-800 text-slate-100'
          }`}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-black flex items-center gap-2 text-amber-400">
              <Flag className="w-5 h-5" />
              <span>🏁 Cierre y Fin de Jornada</span>
            </h3>
            <button
              type="button"
              onClick={() => setShowCloseShiftModal(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 4 Métricas Clave de la Jornada (v10.0) */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {/* 1. Horas trabajadas (Tiempo activo real, descontando pausas) */}
            <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 block">HORAS TRABAJADAS</span>
              <p className="text-base font-black text-white mt-0.5 font-mono">
                {formatStopwatch(activeDurationMs)}
              </p>
              <span className="text-[9px] text-slate-400">
                ({effectiveHours.toFixed(1)} h tiempo activo real)
              </span>
            </div>

            {/* 2. Pausas totales */}
            <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 block">TIEMPO EN PAUSAS</span>
              <p className="text-base font-black text-amber-400 mt-0.5 font-mono">
                {formatStopwatch(totalPausedMs)}
              </p>
              <span className="text-[9px] text-slate-400">
                (Gasolina, lluvia o bodega)
              </span>
            </div>

            {/* 3. Ganancia del turno */}
            <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 block">GANANCIA DEL TURNO</span>
              <p className="text-base font-black text-emerald-400 mt-0.5 font-mono">
                +{formatCOP(grossEarnedCOP)}
              </p>
              <span className="text-[9px] text-slate-400">
                {deliveredCount} entregas completadas
              </span>
            </div>

            {/* 4. Promedio Paquetes/Hora (Con 1 Decimal) */}
            <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 block">RITMO PAQ/HORA</span>
              <p className="text-xl font-black text-blue-400 mt-0.5 font-mono">
                {paceDecimal.toFixed(1)} <span className="text-xs font-bold text-slate-400">paq/h</span>
              </p>
              <span className="text-[9px] font-bold text-emerald-400">
                Meta Part-Time: 6.5 paq/h
              </span>
            </div>
          </div>

          {/* Evaluación Comparativa Part-Time (v10.1) */}
          <div className={`p-3.5 rounded-2xl border-2 space-y-1.5 shadow-lg ${evalColor}`}>
            <div className="flex items-center justify-between text-xs font-black uppercase">
              <span>Evaluación Part-Time ({paceDecimal.toFixed(1)} / 6.5 paq/h)</span>
              <span>Meta $600k COP</span>
            </div>
            <p className="text-xs sm:text-sm font-black leading-snug">
              {evalText}
            </p>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1 mb-1">
              <Fuel className="w-3.5 h-3.5 text-amber-400" />
              Gasto de Gasolina del Día ($ COP)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={closingFuelInput}
              onChange={(e) => setClosingFuelInput(e.target.value)}
              placeholder="12000"
              className="w-full rounded-xl px-3 py-2 text-sm font-mono font-bold bg-slate-950 border border-slate-700 text-white"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-400 block mb-1">
              ¿Qué hacer con paquetes pendientes o no entregados?
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setClosingPendingAction('move_to_tomorrow')}
                className={`p-2 rounded-xl text-xs font-bold border text-left cursor-pointer ${
                  closingPendingAction === 'move_to_tomorrow'
                    ? 'bg-blue-600/30 border-blue-500 text-blue-200'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400'
                }`}
              >
                <p className="font-black text-white">📦 Mover a Mañana</p>
                <p className="text-[10px]">Pasan a la ruta de mañana</p>
              </button>
              <button
                type="button"
                onClick={() => setClosingPendingAction('mark_returned_to_warehouse')}
                className={`p-2 rounded-xl text-xs font-bold border text-left cursor-pointer ${
                  closingPendingAction === 'mark_returned_to_warehouse'
                    ? 'bg-rose-600/30 border-rose-500 text-rose-200'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400'
                }`}
              >
                <p className="font-black text-white">🏭 Devolver Bodega</p>
                <p className="text-[10px]">Registrar como novedad</p>
              </button>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              disabled={isClosingShift}
              onClick={handleConfirmCloseShift}
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-lg active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <Flag className="w-4 h-4" />
              <span>{isClosingShift ? 'Cerrando...' : 'Confirmar Cierre de Jornada'}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowCloseShiftModal(false)}
              className="py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (!currentPkg) {
    const totalEarned = deliveredPkgs.reduce((acc, p) => acc + (p.rate || defaultRate), 0);

    return (
      <div className="max-w-lg mx-auto px-4 py-2.5 space-y-3">
        {renderShiftControlCard()}

        <div
          className={`rounded-3xl border p-6 text-center shadow-xl ${
            highContrastSun
              ? 'bg-white border-slate-300 text-slate-950'
              : 'bg-slate-900/90 border-slate-800 text-slate-100'
          }`}
        >
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto mb-3">
            <PackageCheck className="w-9 h-9" />
          </div>
          <h2 className="text-xl font-black">
            {deliveredCount > 0 ? '¡Ruta del Sector Completada!' : 'Sin paquetes pendientes en cola'}
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
            {deliveredCount > 0
              ? `Has entregado ${deliveredCount} paquetes hoy (${formatCOP(totalEarned, true)}).`
              : 'Escanea tus guías iMile de Shein/Temu antes de arrancar para optimizar el recorrido.'}
          </p>
          <button
            type="button"
            onClick={onOpenScanner}
            className="mt-4 w-full py-3.5 px-5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-sm shadow-lg shadow-blue-600/30 cursor-pointer"
          >
            + ESCANEAR PAQUETES DE RUTA
          </button>
        </div>

        {showCloseShiftModal && renderCloseShiftModal()}
      </div>
    );
  }

  const navLinks = buildNavigationLinks(currentPkg);
  const currentWhatsAppUrl = buildWhatsAppPreNoticeUrl(currentPkg);
  const nextWhatsAppUrl = nextPkg ? buildWhatsAppPreNoticeUrl(nextPkg) : '';
  const pkgRate = currentPkg.rate || defaultRate;

  const formatDoorWait = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-2.5 space-y-3">
      {/* 1. Módulo Control de Jornada (Empezar / Pausas / Terminar) */}
      {renderShiftControlCard()}

      {/* Floating Banner Post-Delivery: 1-Click Pre-Notice to Next Client */}
      {nextClientAlertPkg && (
        <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white shadow-xl border-2 border-emerald-300">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="text-[11px] font-black uppercase tracking-wider bg-black/25 px-2 py-0.5 rounded-full">
                ⚡ ¡ANTES DE ARRANCAR LA MOTO!
              </span>
              <h3 className="text-sm font-black mt-1">
                Avísale al siguiente cliente (#{nextClientAlertPkg.lastFourDigits} - {nextClientAlertPkg.recipientName})
              </h3>
              <p className="text-xs text-emerald-100">
                Dirección: {nextClientAlertPkg.rawAddress}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setNextClientAlertPkg(null)}
              className="text-xs font-bold bg-black/20 px-2 py-1 rounded-lg"
            >
              Cerrar
            </button>
          </div>
          <a
            href={buildWhatsAppPreNoticeUrl(nextClientAlertPkg)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setNextClientAlertPkg(null)}
            className="mt-2.5 w-full py-3 px-4 rounded-xl bg-white text-emerald-900 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md"
          >
            <BellRing className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>🔔 PRE-AVISO AL SIGUIENTE CLIENTE (WHATSAPP 1-CLICK)</span>
          </a>
        </div>
      )}

      {/* Alerta si hay múltiples paquetes en esta misma cuadra o unidad */}
      {currentSameBlock && currentSameBlock.packages.length >= 2 && (
        <div
          className={`p-3 rounded-2xl border-2 flex items-center gap-2.5 ${
            highContrastSun
              ? 'bg-amber-100 border-amber-600 text-amber-950'
              : 'bg-amber-950/80 border-amber-500 text-amber-200'
          }`}
        >
          <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />
          <div className="text-xs font-extrabold leading-snug">
            📦 ¡Ojo! Tienes {currentSameBlock.packages.length} paquetes en esta misma cuadra (
            {currentSameBlock.humanLabel}):{' '}
            {currentSameBlock.packages.map((p) => `#${p.lastFourDigits}`).join(' y ')}
          </div>
        </div>
      )}

      {/* PARADA ACTUAL CARD */}
      <div
        className={`rounded-3xl border-2 p-4 shadow-xl transition-all ${
          highContrastSun
            ? 'bg-white border-blue-600 text-slate-950'
            : 'bg-slate-900 border-blue-500/70 text-slate-50'
        }`}
      >
        {/* Top Row: Queue Badge + Extra Large Last 4 Digits */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-blue-600 text-white">
                PARADA ACTUAL #{currentPkg.routeOrder || 1}
              </span>
              <span className="text-xs font-bold text-slate-400">
                ({activeQueue.length} restantes)
              </span>
            </div>

            <h2 className="mt-2 text-lg font-black leading-tight break-words">
              {currentPkg.rawAddress}
            </h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <p className={`text-xs font-bold ${highContrastSun ? 'text-slate-700' : 'text-slate-300'}`}>
                👤 {currentPkg.recipientName} • 📍 {currentPkg.parsedAddress?.neighborhood || 'Medellín'}
              </p>
              <button
                type="button"
                onClick={() => setShowDetailsModal(true)}
                className="py-0.5 px-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 font-bold text-[10px] border border-blue-500/30 shrink-0 flex items-center gap-0.5 active:scale-95 transition-all cursor-pointer"
                title="Editar nombre, teléfono o datos del cliente"
              >
                <span>✏️ Editar</span>
              </button>
            </div>
            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
              Guía iMile: {currentPkg.trackingNumber}
            </p>
          </div>

          <div className="shrink-0 flex flex-col items-center gap-1.5">
            <div className="px-3.5 py-2 rounded-2xl bg-amber-500 text-slate-950 text-center shadow-lg shadow-amber-500/25 border-2 border-amber-300">
              <span className="block text-[10px] font-black uppercase tracking-wider leading-none">
                BUSCAR GUÍA
              </span>
              <span className="block text-2xl sm:text-3xl font-black font-mono tracking-tight leading-none mt-1">
                #{currentPkg.lastFourDigits}
              </span>
            </div>
            {/* Ubicación y Tamaño del Paquete en la Moto (v8.7) */}
            <PackageSizeBadge size={currentPkg.packageSize} variant="expanded" />
          </div>
        </div>

        {/* Lanzador Directo de Navegación y Llegada: Copiar Dirección + "Ya estoy acá" (v10.0) */}
        <div className="mt-3.5 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleCopyAddress(currentPkg.rawAddress)}
              className="w-full py-3.5 px-3 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-sm flex items-center justify-center gap-2 shadow-xl shadow-blue-500/25 active:scale-[0.98] transition-all cursor-pointer border-2 border-blue-400"
            >
              <Copy className="w-5 h-5 shrink-0" />
              <span>📋 COPIAR DIRECCIÓN</span>
            </button>

            <button
              type="button"
              onClick={handleArrivedAtPoint}
              className={`w-full py-3.5 px-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-xl active:scale-[0.98] transition-all cursor-pointer border-2 ${
                showArrivalActions || currentPkg.arrivedAtPointAt
                  ? 'bg-gradient-to-r from-emerald-500 via-green-500 to-teal-400 text-slate-950 border-emerald-300 shadow-emerald-500/30'
                  : 'bg-gradient-to-r from-emerald-600 via-teal-600 to-green-600 text-white border-emerald-400/80 shadow-emerald-600/30 animate-pulse'
              }`}
            >
              <span className="text-lg">📍</span>
              <span>YA ESTOY ACÁ</span>
            </button>
          </div>

          {/* Menú Rápido de Acciones de Llegada (v9.5) */}
          {showArrivalActions && (
            <div className="p-3.5 rounded-2xl bg-slate-950/95 border-2 border-emerald-500 shadow-2xl space-y-2.5 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-emerald-400 flex items-center gap-1.5 uppercase">
                  <span>📍 Acciones Inmediatas de Llegada</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowArrivalActions(false)}
                  className="text-xs font-bold text-slate-400 hover:text-white px-2 py-0.5 rounded-lg bg-slate-850 border border-slate-700"
                >
                  Cerrar ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <a
                  href={buildArrivalWhatsAppUrl(currentPkg)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black flex items-center justify-center gap-1.5 text-center shadow-md active:scale-95"
                >
                  <MessageCircle className="w-4 h-4 shrink-0" />
                  <span>💬 "Ya Llegué"</span>
                </a>

                <a
                  href={currentPkg.recipientPhone ? `tel:+${currentPkg.recipientPhone}` : '#'}
                  className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black flex items-center justify-center gap-1.5 text-center shadow-md active:scale-95"
                >
                  <PhoneCall className="w-4 h-4 shrink-0" />
                  <span>📞 Llamar Ahora</span>
                </a>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800">
                <button
                  type="button"
                  onClick={async () => {
                    setShowArrivalActions(false);
                    await handleMarkDelivered();
                  }}
                  className="py-3 px-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-lg active:scale-95 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>✅ Entregado Ya</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowArrivalActions(false);
                    setShowIssueModal(true);
                  }}
                  className="py-3 px-2 rounded-xl bg-rose-600/90 hover:bg-rose-500 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-lg active:scale-95 cursor-pointer"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>⚠️ Novedad</span>
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <a
              href={navLinks.googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 border border-slate-700 active:scale-95 transition-all"
            >
              <Map className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span>Google Maps</span>
            </a>

            <button
              type="button"
              onClick={() => handleCopyAddress(currentPkg.rawAddress)}
              className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 border border-slate-700 active:scale-95 transition-all cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Copiar Texto</span>
            </button>
          </div>
        </div>

        {/* Contacto Rápido Cliente Actual */}
        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
          <a
            href={currentWhatsAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="py-2.5 px-3 rounded-xl bg-emerald-600/20 border border-emerald-500/50 text-emerald-400 font-extrabold text-xs flex items-center justify-center gap-1.5 active:scale-95"
          >
            <MessageCircle className="w-4 h-4 shrink-0" />
            <span>WhatsApp Actual</span>
          </a>

          <a
            href={currentPkg.recipientPhone ? `tel:+${currentPkg.recipientPhone}` : '#'}
            className="py-2.5 px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-extrabold text-xs flex items-center justify-center gap-1.5 active:scale-95"
          >
            <PhoneCall className="w-4 h-4 text-blue-400 shrink-0" />
            <span>Llamar Cliente</span>
          </a>
        </div>

        {/* Cronómetro de Espera en Puerta */}
        <div
          className={`mt-3 p-3 rounded-2xl border transition-all ${
            !currentPkg.arrivedAtPointAt
              ? highContrastSun
                ? 'bg-slate-100 border-slate-300'
                : 'bg-slate-950/80 border-slate-800'
              : isOverThreeMinutes
              ? 'bg-rose-600 text-white border-2 border-rose-300 animate-pulse'
              : 'bg-amber-500/20 border-amber-500/60 text-amber-300'
          }`}
        >
          {!currentPkg.arrivedAtPointAt ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Timer className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-xs font-bold">
                  Cronómetro de Espera en Puerta (Máx 3 min)
                </span>
              </div>
              <button
                type="button"
                onClick={handleStartDoorTimer}
                className="px-3.5 py-1.5 rounded-xl bg-amber-500 text-slate-950 font-black text-xs active:scale-95 shrink-0"
              >
                📍 Llegué al punto
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase">
                  {isOverThreeMinutes
                    ? '🚨 ¡MÁS DE 3 MIN ESPERANDO! SE PIERDE RENTABILIDAD'
                    : '⏱️ ESPERANDO EN PUERTA...'}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-lg font-black">
                    {formatDoorWait(doorWaitSeconds)}
                  </span>
                  <button
                    type="button"
                    onClick={handleResetDoorTimer}
                    className="text-[10px] underline font-bold opacity-80"
                  >
                    Reiniciar
                  </button>
                </div>
              </div>

              {isOverThreeMinutes && (
                <div className="pt-1 flex gap-2">
                  <a
                    href={currentPkg.recipientPhone ? `tel:+${currentPkg.recipientPhone}` : '#'}
                    className="flex-1 py-2 px-3 rounded-xl bg-white text-rose-900 font-black text-xs flex items-center justify-center gap-1"
                  >
                    <PhoneCall className="w-3.5 h-3.5" />
                    <span>Llamar Ya</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => setShowIssueModal(true)}
                    className="flex-1 py-2 px-3 rounded-xl bg-slate-950 text-white font-black text-xs flex items-center justify-center gap-1"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span>Marcar No Sale</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Evidencia Fotográfica Ligera (<80KB) + Botón Novedad */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <label className="flex-1 py-2.5 px-3 rounded-xl border border-slate-700 bg-slate-800/70 text-slate-300 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer active:scale-95">
            <Camera className="w-4 h-4 text-blue-400 shrink-0" />
            <span>
              {uploadingPhoto
                ? 'Comprimiendo <80KB...'
                : currentPkg.proofPhotoBase64
                ? '✅ Foto Fachada Guardada'
                : 'Foto Fachada (<80KB)'}
            </span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoCapture}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={() => setShowIssueModal(true)}
            className="py-2.5 px-3 rounded-xl border border-rose-500/40 bg-rose-950/40 text-rose-300 text-xs font-bold flex items-center gap-1 active:scale-95 shrink-0"
          >
            <AlertTriangle className="w-4 h-4" />
            <span>Novedad</span>
          </button>
        </div>

        {/* BOTÓN GIGANTE DE CIERRE EN 1 SEGUNDO: ENTREGADO (+TARIFA) */}
        <button
          type="button"
          onClick={handleMarkDelivered}
          className="mt-3.5 w-full py-4 px-5 rounded-2xl bg-gradient-to-r from-emerald-500 via-emerald-600 to-green-600 hover:from-emerald-400 hover:to-green-500 text-slate-950 font-black text-base sm:text-lg flex items-center justify-center gap-2.5 shadow-xl shadow-emerald-600/30 active:scale-[0.98] transition-transform"
        >
          <CheckCircle2 className="w-6 h-6 stroke-[2.5] shrink-0" />
          <span>✅ ENTREGADO (+{formatCOP(pkgRate)})</span>
        </button>
      </div>

      {/* TARJETA SIGUIENTE PARADA + PRE-AVISO WHATSAPP 1-CLICK */}
      {nextPkg && (
        <div
          className={`rounded-2xl border p-3.5 transition-all ${
            highContrastSun
              ? 'bg-slate-100 border-slate-300 text-slate-900'
              : 'bg-slate-900/75 border-slate-800 text-slate-200'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded bg-slate-800 text-blue-400 border border-slate-700 flex items-center gap-1 shrink-0">
                <span>SIGUIENTE PARADA</span>
                <ArrowRight className="w-3 h-3" />
              </span>
              <span className="text-xs font-bold truncate">
                {nextPkg.recipientName}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <PackageSizeBadge size={nextPkg.packageSize} variant="pill" />
              <span className="text-lg font-black font-mono text-amber-400">
                #{nextPkg.lastFourDigits}
              </span>
            </div>
          </div>

          <p className="text-xs font-bold mt-1">{nextPkg.rawAddress}</p>

          <a
            href={nextWhatsAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2.5 w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md active:scale-95 transition-transform"
          >
            <BellRing className="w-4 h-4 shrink-0" />
            <span>🔔 Pre-aviso al Siguiente Cliente (WhatsApp 1-Click)</span>
          </a>
        </div>
      )}

      {/* Modal para reportar Novedad / Devuelto */}
      {showIssueModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-2 sm:p-4 touch-scroll-y">
          <div
            className={`w-full max-w-md rounded-3xl border p-4 pb-8 space-y-3 max-h-[88dvh] touch-scroll-y my-auto ${
              highContrastSun
                ? 'bg-white border-slate-300 text-slate-950'
                : 'bg-slate-900 border-slate-800 text-slate-100'
            }`}
          >
            <h3 className="text-base font-black flex items-center gap-2 text-rose-400">
              <AlertTriangle className="w-5 h-5" />
              <span>Reportar Novedad en Paquete #{currentPkg.lastFourDigits}</span>
            </h3>
            <p className="text-xs text-slate-400">
              Selecciona el motivo para dejar constancia en el cierre del día:
            </p>
            <div className="space-y-1.5">
              {[
                'Cliente no contesta tras 5 min en puerta',
                'Dirección no existe / Placa errada en guía',
                'Cliente solicita reprogramar entrega',
                'Portería no autoriza recibir paquete',
                'Zona cerrada / Sin acceso vehicular'
              ].map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setIssueReason(reason)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold border ${
                    issueReason === reason
                      ? 'bg-rose-600/20 border-rose-500 text-rose-300'
                      : 'bg-slate-800/60 border-slate-700 text-slate-300'
                  }`}
                >
                  {reason}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={issueReason}
              onChange={(e) => setIssueReason(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-xs font-bold bg-slate-950 border border-slate-700 text-white"
              placeholder="Nota personalizada..."
            />
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleMarkIssue}
                className="flex-1 py-3 rounded-xl bg-rose-600 text-white font-black text-xs"
              >
                Confirmar Novedad y Saltar al Siguiente
              </button>
              <button
                type="button"
                onClick={() => setShowIssueModal(false)}
                className="py-3 px-4 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Cierre de Jornada v8.6 */}
      {showCloseShiftModal && renderCloseShiftModal()}

      {/* Modal Ficha y Edición de Paquete Activo (v10.7) */}
      <PackageDetailsModal
        isOpen={showDetailsModal}
        packageData={currentPkg}
        onClose={() => setShowDetailsModal(false)}
        highContrastSun={highContrastSun}
      />
    </div>
  );
};
