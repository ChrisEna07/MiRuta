import React, { useState, useEffect } from 'react';
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
  ArrowRight
} from 'lucide-react';
import {
  db,
  type DeliveryPackage,
  getDefaultPackageRate,
  ensureShiftExists,
  getTodayShiftId
} from '../db/database';
import {
  playCashRegisterSuccess,
  compressProofPhotoToBase64,
  buildWhatsAppPreNoticeUrl,
  buildNavigationLinks,
  formatCOP
} from '../utils/mediaAndFeedback';
import { detectSameBlockClusters } from '../utils/addressParser';

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
  const [now, setNow] = useState<number>(Date.now());
  const [showIssueModal, setShowIssueModal] = useState<boolean>(false);
  const [issueReason, setIssueReason] = useState<string>('Cliente no contesta tras 5 min');
  const [uploadingPhoto, setUploadingPhoto] = useState<boolean>(false);
  const [nextClientAlertPkg, setNextClientAlertPkg] = useState<DeliveryPackage | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const defaultRate = getDefaultPackageRate();

  const activeQueue = [...packages]
    .filter((p) => p.status === 'pending' || p.status === 'in_progress')
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

  const activateShiftIfWaiting = async () => {
    const s = await ensureShiftExists(getTodayShiftId());
    if (!s.startedAt) {
      await db.shifts.update(s.id, {
        startedAt: Date.now(),
        isPaused: false,
        lastPauseStartedAt: null
      });
    } else if (s.isPaused) {
      const pauseDelta = s.lastPauseStartedAt ? Date.now() - s.lastPauseStartedAt : 0;
      await db.shifts.update(s.id, {
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
    } catch {
      alert('No se pudo comprimir la foto de respaldo.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleMarkDelivered = async () => {
    if (!currentPkg || currentPkg.id === undefined) return;
    const candidateNext = nextPkg || null;

    await activateShiftIfWaiting();
    playCashRegisterSuccess();

    await db.packages.update(currentPkg.id, {
      status: 'delivered',
      rate: currentPkg.rate || defaultRate,
      deliveredAt: Date.now(),
      arrivedAtPointAt: undefined
    });

    if (candidateNext) {
      setNextClientAlertPkg(candidateNext);
    } else {
      setNextClientAlertPkg(null);
    }
  };

  const handleMarkIssue = async () => {
    if (!currentPkg || currentPkg.id === undefined) return;
    const candidateNext = nextPkg || null;

    await activateShiftIfWaiting();
    await db.packages.update(currentPkg.id, {
      status: 'issue',
      issueNote: issueReason,
      deliveredAt: Date.now(),
      arrivedAtPointAt: undefined
    });
    setShowIssueModal(false);

    if (candidateNext) {
      setNextClientAlertPkg(candidateNext);
    }
  };

  if (!currentPkg) {
    const deliveredPkgs = packages.filter((p) => p.status === 'delivered');
    const deliveredCount = deliveredPkgs.length;
    const totalEarned = deliveredPkgs.reduce((acc, p) => acc + (p.rate || defaultRate), 0);

    return (
      <div className="max-w-lg mx-auto px-4 py-4">
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
            className="mt-4 w-full py-3.5 px-5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-sm shadow-lg shadow-blue-600/30"
          >
            + ESCANEAR PAQUETES DE RUTA
          </button>
        </div>
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
            <p className={`text-xs font-bold mt-0.5 ${highContrastSun ? 'text-slate-700' : 'text-slate-300'}`}>
              👤 {currentPkg.recipientName} • 📍 {currentPkg.parsedAddress?.neighborhood || 'Medellín'}
            </p>
            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
              Guía iMile: {currentPkg.trackingNumber}
            </p>
          </div>

          {/* 4 dígitos gigantes para encontrar el paquete en el bolso/parrilla en 2 segundos */}
          <div className="shrink-0 px-3.5 py-2 rounded-2xl bg-amber-500 text-slate-950 text-center shadow-lg shadow-amber-500/25 border-2 border-amber-300">
            <span className="block text-[10px] font-black uppercase tracking-wider leading-none">
              BUSCAR GUÍA
            </span>
            <span className="block text-2xl sm:text-3xl font-black font-mono tracking-tight leading-none mt-1">
              #{currentPkg.lastFourDigits}
            </span>
          </div>
        </div>

        {/* Lanzador Dual de Navegación: Waze + Google Maps */}
        <div className="mt-3.5 grid grid-cols-2 gap-2.5">
          <a
            href={navLinks.wazeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="py-3 px-3 rounded-2xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-md active:scale-95 transition-transform"
          >
            <Navigation className="w-4 h-4 fill-slate-950 shrink-0" />
            <span>IR CON WAZE</span>
          </a>

          <a
            href={navLinks.googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="py-3 px-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md active:scale-95 transition-transform"
          >
            <Map className="w-4 h-4 shrink-0" />
            <span>GOOGLE MAPS</span>
          </a>
        </div>

        {/* Contacto Rápido Cliente Actual (WhatsApp + Llamada) */}
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

        {/* Cronómetro de Espera en Puerta (Alerta Roja > 3 min) */}
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
            <span className="text-lg font-black font-mono text-amber-400 shrink-0">
              #{nextPkg.lastFourDigits}
            </span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div
            className={`w-full max-w-md rounded-3xl border p-4 space-y-3 ${
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
    </div>
  );
};
