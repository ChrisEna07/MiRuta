import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera,
  X,
  CheckCircle2,
  AlertTriangle,
  Zap,
  ScanLine,
  Flashlight,
  PackageCheck
} from 'lucide-react';
import { db, type DeliveryPackage } from '../db/database';
import { sanitizeTrackingInput } from '../utils/formatters';
import { playScannerLaserBeep } from '../utils/scannerSound';
import { playCashRegisterSuccess } from '../utils/mediaAndFeedback';
import { useToast } from './ui/FeedbackSystem';

interface DeliveryCheckoutScannerProps {
  isOpen: boolean;
  onClose: () => void;
  highContrastSun: boolean;
}

export const DeliveryCheckoutScanner: React.FC<DeliveryCheckoutScannerProps> = ({
  isOpen,
  onClose,
  highContrastSun
}) => {
  const toast = useToast();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isCooldownRef = useRef<boolean>(false);

  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>('');
  const [torchEnabled, setTorchEnabled] = useState<boolean>(false);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [deliveredCountThisSession, setDeliveredCountThisSession] = useState<number>(0);
  const [lastFeedback, setLastFeedback] = useState<{
    type: 'success' | 'not_found';
    lastFour?: string;
    tracking?: string;
    address?: string;
  } | null>(null);

  const startScanner = async () => {
    setCameraError('');
    try {
      if (scannerRef.current) {
        try {
          await scannerRef.current.stop();
        } catch {
          // ignore
        }
      }

      const html5Qr = new Html5Qrcode('checkout-qr-reader');
      scannerRef.current = html5Qr;

      await html5Qr.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          qrbox: { width: 280, height: 160 },
          aspectRatio: 1.0
        },
        async (decodedText) => {
          if (isCooldownRef.current) return;
          await handleBarcodeDetected(decodedText);
        },
        () => {
          // Frame callback without code
        }
      );

      setCameraActive(true);

      // Check torch capability
      try {
        const capabilities = html5Qr.getRunningTrackCapabilities();
        if (capabilities && 'torch' in capabilities) {
          setHasTorch(true);
        }
      } catch {
        setHasTorch(false);
      }
    } catch (err: unknown) {
      console.error('Error starting checkout scanner:', err);
      setCameraActive(false);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('NotAllowedError') || errMsg.includes('Permission')) {
        setCameraError('Permiso de cámara denegado. Permite el acceso a la cámara en tu navegador.');
      } else {
        setCameraError('No se pudo iniciar la cámara trasera para el escaneo de entrega.');
      }
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // ignore
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
    setTorchEnabled(false);
  };

  const toggleTorch = async () => {
    if (!scannerRef.current || !hasTorch) return;
    try {
      const nextTorch = !torchEnabled;
      await scannerRef.current.applyVideoConstraints({
        // @ts-expect-error torch is advanced constraint in mobile Chrome
        advanced: [{ torch: nextTorch }]
      });
      setTorchEnabled(nextTorch);
    } catch {
      toast.info('Linterna no soportada en esta cámara');
    }
  };

  const handleBarcodeDetected = async (rawCode: string) => {
    isCooldownRef.current = true;
    const clean = sanitizeTrackingInput(rawCode) || rawCode.trim();

    playScannerLaserBeep();

    try {
      // 1. Buscar en IndexedDB por trackingNumber exacto
      let targetPkg = await db.packages.where('trackingNumber').equals(clean).first();

      // 2. Si no coincide exacto, buscar en paquetes no archivados por últimos 4 dígitos o subcadena
      if (!targetPkg) {
        const allUnarchived = await db.packages.filter((p) => !p.archivedInHistory).toArray();
        targetPkg = allUnarchived.find((p) => {
          if (p.trackingNumber === clean) return true;
          if (clean.length >= 4 && p.lastFourDigits === clean.slice(-4)) return true;
          if (p.trackingNumber && clean && (p.trackingNumber.includes(clean) || clean.includes(p.trackingNumber))) {
            return true;
          }
          return false;
        });
      }

      if (targetPkg && targetPkg.id !== undefined) {
        // Paquete encontrado: marcar de inmediato como Entregado
        const now = Date.now();
        await db.packages.update(targetPkg.id, {
          status: 'delivered',
          deliveredAt: now
        });

        playCashRegisterSuccess();
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([60, 40, 60]);
        }

        setDeliveredCountThisSession((prev) => prev + 1);
        setLastFeedback({
          type: 'success',
          lastFour: targetPkg.lastFourDigits,
          tracking: targetPkg.trackingNumber,
          address: targetPkg.rawAddress
        });
        toast.success(
          `✅ Paquete #${targetPkg.lastFourDigits} Liquidado como Entregado`,
          targetPkg.rawAddress
        );
      } else {
        // Paquete no encontrado en la ruta
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([100, 50, 100]);
        }
        setLastFeedback({
          type: 'not_found',
          tracking: clean
        });
        toast.warning('⚠️ Paquete no encontrado en tu ruta', clean);
      }
    } catch (e) {
      console.error('Error al procesar escaneo de liquidación:', e);
      toast.error('Error procesando el código escaneado');
    } finally {
      // Cooldown de 1.4s para evitar lecturas repetidas del mismo código mientras la cámara enfoca
      setTimeout(() => {
        isCooldownRef.current = false;
      }, 1400);

      // Ocultar feedback tras 3.5s
      setTimeout(() => {
        setLastFeedback(null);
      }, 3500);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setDeliveredCountThisSession(0);
      setLastFeedback(null);
      isCooldownRef.current = false;
      startScanner();
    } else {
      stopScanner();
    }

    return () => {
      stopScanner();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md p-0 sm:p-4 touch-scroll-y">
      <div
        className={`w-full max-w-md rounded-t-3xl sm:rounded-3xl border p-4 pb-8 shadow-2xl space-y-3.5 ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-950'
            : 'bg-slate-900 border-slate-800 text-slate-100'
        }`}
      >
        {/* Header Escáner de Liquidación */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-2xl bg-emerald-500 text-slate-950 font-black">
              <PackageCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-black">
                  Escáner de Liquidación (Entrega)
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                  {deliveredCountThisSession} liquidados
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Solo lee código de barras y marca entregado al instante
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {hasTorch && (
              <button
                type="button"
                onClick={toggleTorch}
                className={`p-2 rounded-xl border transition-all ${
                  torchEnabled
                    ? 'bg-amber-500 text-slate-950 border-amber-300'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
                title="Linterna"
              >
                <Flashlight className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Viewport de Cámara */}
        <div className="relative rounded-2xl overflow-hidden bg-black border-2 border-slate-700 min-h-[260px] flex items-center justify-center">
          <div id="checkout-qr-reader" className="w-full" />

          {/* Guía Visual Láser de Escaneo */}
          {cameraActive && (
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
              <div className="w-64 h-36 border-2 border-dashed border-emerald-400/80 rounded-2xl relative shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                <motion.div
                  initial={{ top: '8%' }}
                  animate={{ top: ['8%', '88%', '8%'] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute inset-x-0 h-0.5 bg-emerald-400 shadow-[0_0_10px_2px_rgba(16,185,129,0.9)]"
                />
              </div>
              <span className="mt-3 text-[11px] font-black px-2.5 py-1 rounded-full bg-black/75 text-emerald-300 border border-emerald-500/50 backdrop-blur-sm">
                Apunta al código de barras del paquete
              </span>
            </div>
          )}

          {cameraError && (
            <div className="p-4 text-center space-y-2">
              <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
              <p className="text-xs font-bold text-rose-300">{cameraError}</p>
              <button
                type="button"
                onClick={startScanner}
                className="px-3 py-1.5 rounded-xl bg-slate-800 text-xs font-black text-white border border-slate-700"
              >
                Reintentar Cámara
              </button>
            </div>
          )}
        </div>

        {/* Feedback Instantáneo Post-Escaneo */}
        <AnimatePresence>
          {lastFeedback && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`p-3.5 rounded-2xl border-2 flex items-center gap-3 shadow-xl ${
                lastFeedback.type === 'success'
                  ? 'bg-emerald-950/90 border-emerald-400 text-emerald-100'
                  : 'bg-rose-950/90 border-rose-500 text-rose-100'
              }`}
            >
              <div
                className={`p-2 rounded-xl shrink-0 ${
                  lastFeedback.type === 'success'
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-rose-500 text-white'
                }`}
              >
                {lastFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 stroke-[2.5]" />
                ) : (
                  <AlertTriangle className="w-5 h-5 stroke-[2.5]" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                {lastFeedback.type === 'success' ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-black font-mono text-amber-300">
                        #{lastFeedback.lastFour}
                      </span>
                      <span className="text-xs font-black uppercase text-emerald-300">
                        ¡Entregado!
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-200 truncate mt-0.5">
                      {lastFeedback.address}
                    </p>
                  </>
                ) : (
                  <>
                    <h4 className="text-xs font-black uppercase text-rose-300">
                      Paquete no encontrado en tu ruta
                    </h4>
                    <p className="text-[11px] font-mono text-slate-300 truncate mt-0.5">
                      Código leído: {lastFeedback.tracking}
                    </p>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Botón de Salir */}
        <div className="pt-1">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-black text-xs sm:text-sm active:scale-95 transition-all cursor-pointer"
          >
            🏁 Listo / Volver a Tareas de Hoy
          </button>
        </div>
      </div>
    </div>
  );
};
