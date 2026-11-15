import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Html5Qrcode } from 'html5-qrcode';
import { motion } from 'framer-motion';
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  PackagePlus,
  Sparkles,
  X,
  Phone,
  MapPin,
  User,
  Hash,
  FlaskConical,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ScanLine,
  Aperture,
  ZoomIn,
} from 'lucide-react';
import {
  db,
  extractLastFourDigits,
  normalizeColombianPhone,
  getTodayShiftId,
  ensureShiftExists,
  getDefaultPackageRate,
  type DeliveryPackage,
} from '../db/database';
import { parseMedellinAddress, parseIMileLabelBlock } from '../utils/addressParser';
import { estimateMedellinCoordinatesFromAddress } from '../utils/routeOptimizer';
import { formatCOP } from '../utils/mediaAndFeedback';
import {
  sanitizeTrackingInput,
  validateAndFormatColombianPhone,
} from '../utils/formatters';
import {
  scanIMileLabelSmart,
  getSmartVisionConfig,
} from '../services/smartLabelScanner';
import { syncToSupabase } from '../services/supabaseSync';
import { useToast } from './ui/FeedbackSystem';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenTestLab?: () => void;
  highContrastSun: boolean;
}

interface AutoFilledFlags {
  trackingNumber?: boolean;
  recipientName?: boolean;
  recipientPhone?: boolean;
  rawAddress?: boolean;
}

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  onOpenTestLab,
  highContrastSun,
}) => {
  const toast = useToast();

  const [activeScannerTab, setActiveScannerTab] = useState<'live' | 'native_hd'>('live');
  const [trackingNumber, setTrackingNumber] = useState<string>('');
  const [recipientName, setRecipientName] = useState<string>('');
  const [recipientPhone, setRecipientPhone] = useState<string>('');
  const [rawAddress, setRawAddress] = useState<string>('');
  const [neighborhood, setNeighborhood] = useState<string>('Medellín');
  const [smartBlockText, setSmartBlockText] = useState<string>('');
  const [editingPackageId, setEditingPackageId] = useState<number | null>(null);

  // Estados de Cámara Inteligente v4.5
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>('');
  const [isAnalyzingLabel, setIsAnalyzingLabel] = useState<boolean>(false);
  const [analysisStageText, setAnalysisStageText] = useState<string>('');
  const [analysisProgress, setAnalysisProgress] = useState<number>(0);
  const [frozenFramePreview, setFrozenFramePreview] = useState<string>('');
  const [capturedLabelThumb, setCapturedLabelThumb] = useState<string>('');
  const [zoomThumbOpen, setZoomThumbOpen] = useState<boolean>(false);
  const [autoFilledFields, setAutoFilledFields] = useState<AutoFilledFlags>({});
  const [smartEngineBadge, setSmartEngineBadge] = useState<string>('');

  const [isListeningVoice, setIsListeningVoice] = useState<boolean>(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'ready'>('idle');

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = 'miruta-barcode-reader-region';

  const todayShiftId = getTodayShiftId();
  const todayPackages =
    useLiveQuery(
      () => db.packages.where('shiftId').equals(todayShiftId).toArray(),
      [todayShiftId]
    ) || [];

  const visionConfig = getSmartVisionConfig();

  // Detección en vivo de duplicados en la ruta de hoy
  const duplicateTodayPkg = React.useMemo(() => {
    const clean = sanitizeTrackingInput(trackingNumber);
    if (clean.length < 4) return null;
    return (
      todayPackages.find(
        (p) =>
          p.id !== editingPackageId &&
          (p.trackingNumber.toUpperCase() === clean ||
            (clean.length === 4 && p.lastFourDigits === clean))
      ) || null
    );
  }, [trackingNumber, todayPackages, editingPackageId]);

  useEffect(() => {
    if (!isOpen) {
      stopCameraScanner();
      setEditingPackageId(null);
      setIsAnalyzingLabel(false);
      setFrozenFramePreview('');
    }
    return () => {
      stopCameraScanner();
    };
  }, [isOpen]);

  const startCameraScanner = async () => {
    setCameraError('');
    setFrozenFramePreview('');
    try {
      setCameraActive(true);
      setTimeout(async () => {
        try {
          const html5QrCode = new Html5Qrcode(scannerContainerId);
          scannerRef.current = html5QrCode;
          await html5QrCode.start(
            { facingMode: 'environment' },
            {
              fps: 15,
              qrbox: { width: 260, height: 115 },
            },
            (decodedText) => {
              const clean = sanitizeTrackingInput(decodedText);
              if (clean && !isAnalyzingLabel) {
                setTrackingNumber(clean);
                setAutoFilledFields((prev) => ({ ...prev, trackingNumber: true }));
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                  navigator.vibrate(75);
                }
                toast.info(
                  `📷 Guía #${extractLastFourDigits(clean)} leída`,
                  'Pulsa "📸 CAPTURAR ETIQUETA COMPLETA" para rellenar Nombre, Celular y Dirección.'
                );
              }
            },
            () => {
              // Ignorar frames sin código
            }
          );
        } catch (err) {
          setCameraError(
            err instanceof Error
              ? `No se pudo abrir cámara en vivo: ${err.message}. Usa la pestaña "📷 Foto HD Cámara Nativa".`
              : 'Permiso de cámara no disponible. Usa el botón "📷 Foto HD con Cámara Nativa".'
          );
          setCameraActive(false);
        }
      }, 150);
    } catch {
      setCameraError('Error inicializando lector de códigos.');
      setCameraActive(false);
    }
  };

  const stopCameraScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch {
        // Ignorar al desmontar
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
  };

  /**
   * Procesa el resultado de `scanIMileLabelSmart` y rellena el formulario con resaltado verde esmeralda
   * y vibración doble de confirmación.
   */
  const applySmartLabelResultToForm = async (
    source: File | Blob | HTMLVideoElement | string
  ) => {
    setIsAnalyzingLabel(true);
    setAnalysisStageText('🔍 Leyendo código de barras y bloque "TO"...');
    setAnalysisProgress(20);

    try {
      const result = await scanIMileLabelSmart(source, (stageMsg, pct) => {
        setAnalysisStageText(stageMsg);
        if (pct !== undefined) setAnalysisProgress(pct);
      });

      setCapturedLabelThumb(result.previewDataUrl);
      setSmartEngineBadge(result.engineBadge);

      const newFlags: AutoFilledFlags = {};

      if (result.trackingNumber) {
        setTrackingNumber(result.trackingNumber);
        newFlags.trackingNumber = true;
      }
      if (result.recipientName) {
        setRecipientName(result.recipientName);
        newFlags.recipientName = true;
      }
      if (result.recipientPhone) {
        const formattedPhone = validateAndFormatColombianPhone(result.recipientPhone);
        setRecipientPhone(formattedPhone.formatted);
        newFlags.recipientPhone = true;
      }
      if (result.rawAddress) {
        setRawAddress(result.rawAddress);
        newFlags.rawAddress = true;
      }
      if (result.neighborhood) {
        setNeighborhood(result.neighborhood);
      }

      setAutoFilledFields((prev) => ({ ...prev, ...newFlags }));

      // Vibración doble de confirmación
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([70, 50, 110]);
      }

      if (result.fieldsDetectedCount >= 2) {
        toast.success(
          `✨ Etiqueta #${result.lastFourDigits} autocompletada (${result.durationMs}ms)`,
          `${result.recipientName || 'Cliente'} • ${result.rawAddress || 'Revisa dirección'}`
        );
      } else if (result.trackingNumber) {
        toast.info(
          `📷 Guía #${result.lastFourDigits} detectada`,
          'Acércate un poco más al bloque "TO" o usa "📷 Foto HD" para leer dirección y teléfono.'
        );
      } else {
        toast.warning(
          '⚠️ No se distinguieron textos claros en la foto',
          'Intenta con "📷 Foto HD con Cámara Nativa" enfocando de cerca el bloque TO.'
        );
      }
    } catch (err) {
      toast.error(
        '⚠️ No se pudo procesar la foto de la etiqueta',
        err instanceof Error ? err.message : 'Intenta nuevamente.'
      );
    } finally {
      setIsAnalyzingLabel(false);
      setFrozenFramePreview('');
      setAnalysisStageText('');
      setAnalysisProgress(0);
    }
  };

  /**
   * Pestaña A: Congela el fotograma actual del `<video>` en vivo y ejecuta el motor de 3 capas.
   */
  const handleCaptureLiveVideoFrame = async () => {
    const container = document.getElementById(scannerContainerId);
    const videoEl = container?.querySelector('video') as HTMLVideoElement | null;

    if (!videoEl || videoEl.readyState < 2) {
      toast.warning(
        '⚠️ El video de cámara aún no está listo',
        'Espera un segundo o usa el botón "📷 Foto HD con Cámara Nativa".'
      );
      return;
    }

    // Congelar instantáneamente una miniatura para el efecto de Láser de Escaneo Inteligente
    try {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = videoEl.videoWidth || 640;
      tempCanvas.height = videoEl.videoHeight || 480;
      const ctx = tempCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoEl, 0, 0, tempCanvas.width, tempCanvas.height);
        const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.88);
        setFrozenFramePreview(dataUrl);
        await stopCameraScanner();
        await applySmartLabelResultToForm(dataUrl);
      }
    } catch {
      toast.error('⚠️ Error capturando el fotograma en vivo');
    }
  };

  /**
   * Pestaña B: Recibe la foto HD tomada con la cámara nativa de Android o desde galería.
   */
  const handleNativeCameraFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const tempUrl = URL.createObjectURL(file);
    setFrozenFramePreview(tempUrl);
    await stopCameraScanner();
    await applySmartLabelResultToForm(file);
    URL.revokeObjectURL(tempUrl);
    e.target.value = '';
  };

  const handleToggleVoiceCapture = () => {
    const SpeechRecognitionAPI =
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      toast.warning(
        '🎙️ Dictado directo no soportado en este navegador',
        'Usa el botón de micrófono del teclado de tu Android.'
      );
      return;
    }

    if (isListeningVoice) {
      setIsListeningVoice(false);
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recognition = new (SpeechRecognitionAPI as any)();
      recognition.lang = 'es-CO';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      setIsListeningVoice(true);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript || '';
        if (transcript) {
          setSmartBlockText(transcript);
          applySmartBlockParse(transcript);
          toast.info('🎙️ Texto capturado por voz', transcript);
        }
        setIsListeningVoice(false);
      };

      recognition.onerror = () => {
        setIsListeningVoice(false);
      };

      recognition.onend = () => {
        setIsListeningVoice(false);
      };

      recognition.start();
    } catch {
      setIsListeningVoice(false);
    }
  };

  const applySmartBlockParse = (textToParse: string) => {
    const parsed = parseIMileLabelBlock(textToParse);
    if (parsed.trackingNumber && !trackingNumber) {
      setTrackingNumber(sanitizeTrackingInput(parsed.trackingNumber));
      setAutoFilledFields((prev) => ({ ...prev, trackingNumber: true }));
    }
    if (parsed.recipientName) {
      setRecipientName(parsed.recipientName);
      setAutoFilledFields((prev) => ({ ...prev, recipientName: true }));
    }
    if (parsed.recipientPhone) {
      const formattedPhone = validateAndFormatColombianPhone(parsed.recipientPhone);
      setRecipientPhone(formattedPhone.formatted);
      setAutoFilledFields((prev) => ({ ...prev, recipientPhone: true }));
    }
    if (parsed.rawAddress) {
      setRawAddress(parsed.rawAddress);
      setAutoFilledFields((prev) => ({ ...prev, rawAddress: true }));
    }
  };

  const handleLoadDuplicateForUpdate = (pkg: DeliveryPackage) => {
    setEditingPackageId(pkg.id ?? null);
    setTrackingNumber(pkg.trackingNumber);
    setRecipientName(pkg.recipientName);
    setRecipientPhone(validateAndFormatColombianPhone(pkg.recipientPhone).formatted);
    setRawAddress(pkg.rawAddress);
    setNeighborhood(pkg.parsedAddress?.neighborhood || 'Medellín');
    toast.info(
      `✏️ Editando guía #${pkg.lastFourDigits}`,
      'Actualiza los datos y guarda sin duplicar el paquete.'
    );
  };

  const parsedAddressPreview = parseMedellinAddress(rawAddress, neighborhood);
  const isAddressComplete =
    parsedAddressPreview.mainNum > 0 && parsedAddressPreview.secNum > 0;
  const phoneValidation = validateAndFormatColombianPhone(recipientPhone);
  const lastFourPreview = extractLastFourDigits(trackingNumber || '0000');
  const activeDefaultRate = getDefaultPackageRate();

  const hasAnyAutoFilled =
    autoFilledFields.trackingNumber ||
    autoFilledFields.recipientName ||
    autoFilledFields.recipientPhone ||
    autoFilledFields.rawAddress;

  const handleSavePackage = async (e: React.FormEvent, keepOpenForNext = true) => {
    e.preventDefault();

    const cleanTrack = sanitizeTrackingInput(trackingNumber);
    if (cleanTrack.length > 0 && cleanTrack.length < 4) {
      toast.error(
        '⚠️ La guía debe tener al menos 4 dígitos válidos',
        'Verifica el número de guía iMile o déjalo vacío para autogenerar.'
      );
      return;
    }

    if (!rawAddress.trim()) {
      toast.error(
        '⚠️ Ingresa la dirección de entrega',
        'Ejemplo: Carrera 43C # 100 - 52 (Medellín)'
      );
      return;
    }

    if (duplicateTodayPkg && !editingPackageId) {
      toast.warning(
        `⚠️ La guía #${duplicateTodayPkg.lastFourDigits} ya está en tu ruta de hoy`,
        'Pulsa "Actualizar" en el aviso amarillo para no duplicarla.'
      );
      return;
    }

    setSaveState('saving');

    try {
      const finalTracking =
        cleanTrack || `610302${Math.floor(1000000 + Math.random() * 9000000)}`;
      const shiftId = getTodayShiftId();
      await ensureShiftExists(shiftId);

      const parsedAddr = parseMedellinAddress(rawAddress, neighborhood);

      if (editingPackageId) {
        const existingPkg = await db.packages.get(editingPackageId);
        if (existingPkg) {
          const updatedPkg: DeliveryPackage = {
            ...existingPkg,
            trackingNumber: finalTracking,
            lastFourDigits: extractLastFourDigits(finalTracking),
            recipientName: recipientName.trim() || 'Cliente iMile',
            recipientPhone: normalizeColombianPhone(recipientPhone),
            rawAddress: rawAddress.trim(),
            parsedAddress: parsedAddr,
          };
          updatedPkg.coordinates = estimateMedellinCoordinatesFromAddress(updatedPkg);
          await db.packages.put(updatedPkg);
          toast.success(
            `✅ Guía #${updatedPkg.lastFourDigits} actualizada sin duplicar`,
            updatedPkg.rawAddress
          );
        }
      } else {
        const existingToday = await db.packages.where('shiftId').equals(shiftId).toArray();
        const maxOrder = existingToday.reduce((max, p) => Math.max(max, p.routeOrder || 0), 0);

        const newPkg: DeliveryPackage = {
          trackingNumber: finalTracking,
          lastFourDigits: extractLastFourDigits(finalTracking),
          recipientName: recipientName.trim() || 'Cliente iMile',
          recipientPhone: normalizeColombianPhone(recipientPhone),
          rawAddress: rawAddress.trim(),
          parsedAddress: parsedAddr,
          coordinates: null,
          routeOrder: maxOrder + 1,
          status: 'pending',
          issueNote: '',
          rate: getDefaultPackageRate(),
          shiftId,
          scannedAt: Date.now(),
          archivedInHistory: false,
        };
        newPkg.coordinates = estimateMedellinCoordinatesFromAddress(newPkg);

        await db.packages.add(newPkg);
        toast.success(
          `✅ Paquete #${newPkg.lastFourDigits} registrado en ruta`,
          `${newPkg.rawAddress} • Sincronizando con Supabase`
        );
      }

      syncToSupabase(true).catch(() => {});

      setSaveState('ready');
      setEditingPackageId(null);
      setTrackingNumber('');
      setRecipientName('');
      setRecipientPhone('');
      setRawAddress('');
      setSmartBlockText('');
      setCapturedLabelThumb('');
      setAutoFilledFields({});
      setSmartEngineBadge('');

      setTimeout(() => {
        setSaveState('idle');
        if (!keepOpenForNext) {
          onClose();
        }
      }, 900);
    } catch {
      setSaveState('idle');
      toast.error('⚠️ No se pudo guardar el paquete en IndexedDB');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto">
      <div
        className={`w-full max-w-lg rounded-t-3xl sm:rounded-3xl border p-4 shadow-2xl max-h-[94vh] overflow-y-auto ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-950'
            : 'bg-slate-900 border-slate-800 text-slate-50'
        }`}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/60 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 rounded-xl bg-gradient-to-br from-blue-600 to-emerald-600 text-white shrink-0">
              <PackagePlus className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black leading-tight truncate">
                {editingPackageId
                  ? 'Actualizar Guía en Ruta'
                  : '📸 Cámara Inteligente iMile v4.5'}
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                {visionConfig.hasAiVisionKey
                  ? '🟢 IA Vision + OCR Offline'
                  : '⚡ Barcode Nativo + OCR Local Offline'}{' '}
                • {formatCOP(activeDefaultRate)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onOpenTestLab && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenTestLab();
                }}
                className="px-2.5 py-1.5 rounded-xl bg-purple-600/20 border border-purple-500/40 text-purple-300 font-black text-[11px] flex items-center gap-1"
              >
                <FlaskConical className="w-3.5 h-3.5" />
                <span>Lab Test</span>
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

        {/* Selector de Modos de Cámara Inteligente Full-Label (Pestaña A vs Pestaña B) */}
        <div className="mt-3 grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-slate-950/90 border border-slate-800">
          <button
            type="button"
            onClick={() => setActiveScannerTab('live')}
            className={`py-2 px-2.5 rounded-xl text-[11px] font-black flex items-center justify-center gap-1.5 transition-all ${
              activeScannerTab === 'live'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ScanLine className="w-3.5 h-3.5 shrink-0" />
            <span>⚡ Escáner En Vivo</span>
          </button>

          <button
            type="button"
            onClick={() => {
              stopCameraScanner();
              setActiveScannerTab('native_hd');
            }}
            className={`py-2 px-2.5 rounded-xl text-[11px] font-black flex items-center justify-center gap-1.5 transition-all ${
              activeScannerTab === 'native_hd'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Aperture className="w-3.5 h-3.5 shrink-0" />
            <span>📷 Cámara Nativa HD</span>
          </button>
        </div>

        {/* Overlay de Láser de Escaneo Inteligente mientras procesa la etiqueta */}
        {isAnalyzingLabel && (
          <div className="mt-3 relative rounded-2xl overflow-hidden border-2 border-emerald-400 bg-slate-950 shadow-2xl">
            {frozenFramePreview ? (
              <img
                src={frozenFramePreview}
                alt="Analizando etiqueta iMile"
                className="w-full h-48 object-cover opacity-65"
              />
            ) : (
              <div className="w-full h-44 bg-slate-950" />
            )}

            {/* Efecto Láser de Escaneo Inteligente recorriendo la etiqueta */}
            <motion.div
              initial={{ top: '5%' }}
              animate={{ top: ['8%', '88%', '8%'] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_18px_4px_rgba(16,185,129,0.85)] z-10"
            />

            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/45 to-slate-950/75 flex flex-col items-center justify-center p-4 text-center">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center mb-2">
                <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
              </div>
              <p className="text-xs sm:text-sm font-black text-white tracking-wide">
                {analysisStageText || '🧠 Interpretando Nombre, Celular y Dirección...'}
              </p>
              <div className="w-48 h-1.5 bg-slate-800 rounded-full overflow-hidden mt-2.5">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-300"
                  style={{ width: `${Math.max(15, analysisProgress)}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* CONTENIDO DE PESTAÑA A o PESTAÑA B (Cuando no está analizando) */}
        {!isAnalyzingLabel && (
          <div className="mt-3 space-y-2">
            {activeScannerTab === 'live' ? (
              <>
                {!cameraActive ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={startCameraScanner}
                      className="py-3.5 px-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 active:scale-[0.99]"
                    >
                      <Camera className="w-5 h-5 shrink-0" />
                      <span>ABRIR ESCÁNER EN VIVO</span>
                    </button>

                    <label className="py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 cursor-pointer active:scale-[0.99]">
                      <Aperture className="w-5 h-5 shrink-0" />
                      <span>📷 FOTO HD ETIQUETA COMPLETA</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleNativeCameraFileChange}
                        className="hidden"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="rounded-2xl overflow-hidden border-2 border-blue-500 bg-black relative space-y-0">
                    <div id={scannerContainerId} className="w-full min-h-[210px]" />

                    {/* Botón Central Destacado: 📸 CAPTURAR E INTERPRETAR ETIQUETA COMPLETA */}
                    <div className="p-2.5 bg-slate-950/95 border-t border-slate-800 space-y-2">
                      <button
                        type="button"
                        onClick={handleCaptureLiveVideoFrame}
                        className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xl shadow-emerald-500/30 border-2 border-emerald-200 active:scale-95 transition-transform"
                      >
                        <Sparkles className="w-5 h-5 fill-slate-950 shrink-0" />
                        <span>📸 CAPTURAR E INTERPRETAR ETIQUETA COMPLETA</span>
                      </button>

                      <button
                        type="button"
                        onClick={stopCameraScanner}
                        className="w-full py-2 rounded-xl bg-rose-600/90 text-white font-bold text-xs flex items-center justify-center gap-1.5"
                      >
                        <CameraOff className="w-4 h-4" />
                        <span>Cerrar Cámara</span>
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Pestaña B: Usar Cámara Nativa del Celular (HD / Macro) */
              <div
                className={`p-3.5 rounded-2xl border-2 border-dashed space-y-2.5 ${
                  highContrastSun
                    ? 'bg-emerald-50 border-emerald-500 text-slate-950'
                    : 'bg-emerald-950/25 border-emerald-500/50 text-slate-100'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className="p-2 rounded-xl bg-emerald-600 text-white shrink-0">
                    <Aperture className="w-5 h-5" />
                  </div>
                  <div className="text-xs">
                    <p className="font-black text-emerald-400">
                      Modo Lente Macro / Autoenfoque Láser Nativo Android
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                      Abre la cámara original de tu celular para tomar una foto nítida de la etiqueta blanca de iMile y autocompletar Guía, #4 Dígitos, Cliente, Celular y Dirección.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 cursor-pointer active:scale-95 transition-transform">
                    <Camera className="w-5 h-5 shrink-0" />
                    <span>📷 FOTO HD CON CÁMARA NATIVA</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleNativeCameraFileChange}
                      className="hidden"
                    />
                  </label>

                  <label className="py-3.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-transform">
                    <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>🖼️ Elegir Foto de Galería</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleNativeCameraFileChange}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            )}

            {cameraError && (
              <p className="mt-1 text-xs font-semibold text-rose-400">{cameraError}</p>
            )}
          </div>
        )}

        {/* Banner + Miniatura de Verificación Visual cuando la Cámara Inteligente autocompleta */}
        {(hasAnyAutoFilled || capturedLabelThumb) && (
          <div className="mt-3 p-2.5 rounded-2xl bg-emerald-950/60 border border-emerald-500/50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {capturedLabelThumb && (
                <div
                  onClick={() => setZoomThumbOpen(true)}
                  className="relative w-14 h-14 rounded-xl overflow-hidden border-2 border-emerald-400 shrink-0 cursor-pointer group"
                >
                  <img
                    src={capturedLabelThumb}
                    alt="Miniatura etiqueta iMile"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-80 group-hover:opacity-100">
                    <ZoomIn className="w-4 h-4 text-white" />
                  </div>
                </div>
              )}
              <div className="min-w-0">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/25 text-emerald-300 border border-emerald-400/40">
                  ✨ Autocompletado por Cámara Inteligente
                </span>
                <p className="text-[11px] text-slate-300 font-semibold mt-0.5 truncate">
                  {smartEngineBadge || 'Datos extraídos de la etiqueta iMile'}
                </p>
                {capturedLabelThumb && (
                  <button
                    type="button"
                    onClick={() => setZoomThumbOpen(true)}
                    className="text-[10px] font-black text-amber-300 underline mt-0.5"
                  >
                    🔍 Tocar miniatura para verificar foto
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Fast Voice / OCR Block Capture ("TO" Block) */}
        <div
          className={`mt-3 p-2.5 rounded-2xl border ${
            highContrastSun
              ? 'bg-slate-50 border-slate-300'
              : 'bg-slate-950/80 border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[11px] font-extrabold flex items-center gap-1 text-blue-400">
              <Sparkles className="w-3.5 h-3.5" />
              Pegar Bloque &quot;TO&quot; o Dictar por Voz
            </span>
            <button
              type="button"
              onClick={handleToggleVoiceCapture}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-black flex items-center gap-1 transition-all ${
                isListeningVoice
                  ? 'bg-rose-600 text-white animate-pulse'
                  : 'bg-emerald-600 text-white'
              }`}
            >
              {isListeningVoice ? (
                <>
                  <MicOff className="w-3 h-3" />
                  <span>Escuchando...</span>
                </>
              ) : (
                <>
                  <Mic className="w-3 h-3" />
                  <span>Dictar Voz</span>
                </>
              )}
            </button>
          </div>
          <input
            type="text"
            value={smartBlockText}
            onChange={(e) => {
              setSmartBlockText(e.target.value);
              applySmartBlockParse(e.target.value);
            }}
            placeholder="Ej: Alba Lucia Lopera 573225873762 Carrera 43c #100 52"
            className={`w-full rounded-xl px-3 py-1.5 text-xs font-medium border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              highContrastSun
                ? 'bg-white border-slate-300 text-slate-950'
                : 'bg-slate-900 border-slate-700 text-white'
            }`}
          />
        </div>

        {/* Manual / Assisted Form with Auto-Fill Emerald Highlighting */}
        <form onSubmit={(e) => handleSavePackage(e, true)} className="mt-3 space-y-3">
          <div className="grid grid-cols-3 gap-2 items-center">
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                  <Hash className="w-3.5 h-3.5 text-blue-400" />
                  GUÍA IMILE (13 DÍGITOS)
                </label>
                {autoFilledFields.trackingNumber && (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    ✨ Auto
                  </span>
                )}
              </div>
              <input
                type="text"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(sanitizeTrackingInput(e.target.value))}
                placeholder="Ej: 6103026696672"
                className={`w-full rounded-xl px-3 py-2.5 text-sm font-mono font-bold border focus:outline-none focus:ring-2 transition-colors ${
                  duplicateTodayPkg
                    ? 'border-amber-500 focus:ring-amber-500'
                    : autoFilledFields.trackingNumber
                    ? 'border-emerald-500 bg-emerald-950/20 focus:ring-emerald-500'
                    : 'border-slate-700 focus:ring-blue-500'
                } ${
                  highContrastSun
                    ? 'bg-white text-slate-950'
                    : 'bg-slate-950 text-white'
                }`}
              />
            </div>

            <div className="flex flex-col items-center justify-center p-2 rounded-2xl bg-amber-500/15 border-2 border-amber-500/60">
              <span className="text-[10px] font-extrabold uppercase text-amber-400">
                BOLSO #4
              </span>
              <span className="text-2xl font-black tracking-wider text-amber-400 font-mono">
                {lastFourPreview}
              </span>
            </div>
          </div>

          {/* Aviso de Guía Duplicada en tiempo real */}
          {duplicateTodayPkg && (
            <div className="p-2.5 rounded-2xl bg-amber-500/15 border border-amber-500/50 flex items-center justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-tight">
                  <p className="font-black text-amber-300">
                    ⚠️ Esta guía (#{duplicateTodayPkg.lastFourDigits}) ya está en tu ruta de hoy
                  </p>
                  <p className="text-amber-200/80 truncate mt-0.5">
                    {duplicateTodayPkg.rawAddress} ({duplicateTodayPkg.recipientName})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleLoadDuplicateForUpdate(duplicateTodayPkg)}
                className="px-2.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[10px] shrink-0 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Actualizar</span>
              </button>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                DIRECCIÓN DE ENTREGA (MEDELLÍN) *
              </label>
              {autoFilledFields.rawAddress && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  ✨ Autocompletado
                </span>
              )}
            </div>
            <input
              type="text"
              required
              value={rawAddress}
              onChange={(e) => setRawAddress(e.target.value)}
              placeholder="Ej: Carrera 43c #100 52 Apto 301"
              className={`w-full rounded-xl px-3 py-2.5 text-sm font-bold border focus:outline-none focus:ring-2 transition-colors ${
                autoFilledFields.rawAddress
                  ? 'border-emerald-500 bg-emerald-950/20 focus:ring-emerald-500'
                  : 'border-slate-700 focus:ring-blue-500'
              } ${
                highContrastSun
                  ? 'bg-white text-slate-950'
                  : 'bg-slate-950 text-white'
              }`}
            />
            {rawAddress.trim() && (
              <div
                className={`mt-1.5 px-2.5 py-1.5 rounded-xl border flex items-center justify-between text-[11px] font-bold flex-wrap gap-1 ${
                  isAddressComplete
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                    : 'bg-amber-950/40 border-amber-500/40 text-amber-300'
                }`}
              >
                {isAddressComplete ? (
                  <>
                    <span>
                      ✅ Detectado: {parsedAddressPreview.mainType}{' '}
                      {parsedAddressPreview.mainNum}
                      {parsedAddressPreview.mainLetter} # {parsedAddressPreview.secNum}
                      {parsedAddressPreview.secLetter} - {parsedAddressPreview.plate} (
                      {neighborhood || 'Medellín'})
                    </span>
                    <span className="font-mono bg-emerald-500/20 px-1.5 py-0.5 rounded text-[10px]">
                      Cuadra: {parsedAddressPreview.blockKey}
                    </span>
                  </>
                ) : (
                  <span>
                    ⚠️ Agrega el número de calle/carrera para enrutar mejor (ej. CR 43C # 100 - 52)
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-blue-400" />
                  DESTINATARIO (BLOQUE TO)
                </label>
                {autoFilledFields.recipientName && (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    ✨ Auto
                  </span>
                )}
              </div>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Alba Lucia Lopera Castrillon"
                className={`w-full rounded-xl px-3 py-2 text-sm font-medium border focus:outline-none focus:ring-2 transition-colors ${
                  autoFilledFields.recipientName
                    ? 'border-emerald-500 bg-emerald-950/20 focus:ring-emerald-500'
                    : 'border-slate-700 focus:ring-blue-500'
                } ${
                  highContrastSun
                    ? 'bg-white text-slate-950'
                    : 'bg-slate-950 text-white'
                }`}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5 text-emerald-400" />
                  CELULAR WHATSAPP (573...)
                </label>
                {autoFilledFields.recipientPhone && (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    ✨ Auto
                  </span>
                )}
              </div>
              <input
                type="tel"
                inputMode="tel"
                value={recipientPhone}
                onChange={(e) => {
                  const res = validateAndFormatColombianPhone(e.target.value);
                  setRecipientPhone(res.formatted);
                }}
                placeholder="322 587 3762"
                className={`w-full rounded-xl px-3 py-2 text-sm font-mono font-bold border focus:outline-none focus:ring-2 transition-colors ${
                  recipientPhone && !phoneValidation.isValid
                    ? 'border-amber-500 focus:ring-amber-500'
                    : (recipientPhone && phoneValidation.isValid) ||
                      autoFilledFields.recipientPhone
                    ? 'border-emerald-500 bg-emerald-950/20 focus:ring-emerald-500'
                    : 'border-slate-700 focus:ring-blue-500'
                } ${
                  highContrastSun
                    ? 'bg-white text-slate-950'
                    : 'bg-slate-950 text-white'
                }`}
              />
              {recipientPhone && phoneValidation.helperText && (
                <p
                  className={`text-[10px] font-bold mt-1 ${
                    phoneValidation.isValid ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {phoneValidation.helperText}
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-400 mb-1">
              BARRIO / SECTOR ASIGNADO
            </label>
            <input
              type="text"
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              placeholder="Ej: El Poblado / Laureles / Belén / Castilla"
              className={`w-full rounded-xl px-3 py-2 text-xs font-bold border ${
                highContrastSun
                  ? 'bg-white border-slate-300 text-slate-950'
                  : 'bg-slate-950 border-slate-700 text-white'
              }`}
            />
          </div>

          <div className="pt-2 flex gap-2">
            <button
              type="submit"
              disabled={saveState !== 'idle'}
              className="flex-1 py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-75 text-white font-black text-sm shadow-lg shadow-emerald-600/30 active:scale-[0.99] flex items-center justify-center gap-2 transition-all"
            >
              {saveState === 'saving' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>GUARDANDO...</span>
                </>
              ) : saveState === 'ready' ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>✅ ¡LISTO!</span>
                </>
              ) : editingPackageId ? (
                <span>💾 ACTUALIZAR PAQUETE EXISTENTE</span>
              ) : (
                <span>💾 GUARDAR Y ESCANEAR OTRO</span>
              )}
            </button>
            <button
              type="button"
              disabled={saveState !== 'idle'}
              onClick={(e) => handleSavePackage(e, false)}
              className="py-3.5 px-4 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:opacity-75 text-white font-bold text-xs active:scale-95 transition-all"
            >
              Guardar y Salir
            </button>
          </div>
        </form>
      </div>

      {/* Modal de Zoom para Verificar la Foto de la Etiqueta */}
      {zoomThumbOpen && capturedLabelThumb && (
        <div
          onClick={() => setZoomThumbOpen(false)}
          className="fixed inset-0 z-[70] bg-black/95 flex items-center justify-center p-4"
        >
          <div className="max-w-xl w-full space-y-2">
            <div className="flex items-center justify-between text-white">
              <span className="text-xs font-black">
                Foto de Etiqueta Capturada (#{lastFourPreview})
              </span>
              <button
                type="button"
                onClick={() => setZoomThumbOpen(false)}
                className="p-2 rounded-xl bg-slate-800 text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={capturedLabelThumb}
              alt="Etiqueta capturada"
              className="w-full max-h-[82vh] object-contain rounded-2xl border border-slate-700"
            />
          </div>
        </div>
      )}
    </div>
  );
};
