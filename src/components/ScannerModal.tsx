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
  Zap,
  Edit3,
  ClipboardPaste,
} from 'lucide-react';
import {
  db,
  extractLastFourDigits,
  normalizeColombianPhone,
  getTodayShiftId,
  ensureShiftExists,
  getDefaultPackageRate,
  getMaxMotorcycleCapacity,
  type DeliveryPackage,
} from '../db/database';
import { parseMedellinAddress, parseIMileLabelBlock } from '../utils/addressParser';
import { estimateMedellinCoordinatesFromAddress } from '../utils/routeOptimizer';
import { formatCOP, playCashRegisterSuccess } from '../utils/mediaAndFeedback';
import { playScannerLaserBeep } from '../utils/scannerSound';
import {
  sanitizeTrackingInput,
  validateAndFormatColombianPhone,
} from '../utils/formatters';
import {
  scanIMileLabelSmart,
  getSmartVisionConfig,
} from '../services/smartLabelScanner';
import {
  recallFromLearnedMemory,
  learnFromConfirmedPackage,
  getLearningEngineStats,
  ensureBaselineLearnedPatterns,
} from '../services/labelLearningEngine';
import { inferMedellinComunaAndNormalizeAddress } from '../services/aiCopilotService';
import { syncToSupabase } from '../services/supabaseSync';
import { useToast } from './ui/FeedbackSystem';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenTestLab?: () => void;
  onNavigateToRoute?: () => void;
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
  onNavigateToRoute,
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

  // Contador Global de Carga y Alerta de Capacidad de Moto v10.2
  const [sessionCount, setSessionCount] = useState<number>(0);
  const [totalPendingCount, setTotalPendingCount] = useState<number>(0);
  const [showCapacityAlert, setShowCapacityAlert] = useState<boolean>(false);

  const refreshTotalPendingCount = async () => {
    try {
      const all = await db.packages.toArray();
      const count = all.filter(
        (p) => !p.archivedInHistory && (p.status === 'pending' || p.status === 'in_progress')
      ).length;
      setTotalPendingCount(count);
      return count;
    } catch {
      return 0;
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSessionCount(0);
      setShowCapacityAlert(false);
      refreshTotalPendingCount();
    }
  }, [isOpen]);

  const getSessionBadgeClasses = (count: number) => {
    if (count >= 20) {
      return highContrastSun
        ? 'bg-rose-600 text-white border-2 border-rose-800 animate-pulse font-black'
        : 'bg-rose-500/25 text-rose-300 border border-rose-500/60 animate-pulse font-black shadow-[0_0_10px_rgba(244,63,94,0.4)]';
    }
    if (count >= 15) {
      return highContrastSun
        ? 'bg-amber-400 text-slate-950 border-2 border-amber-600 font-black'
        : 'bg-amber-500/25 text-amber-300 border border-amber-500/60 font-black';
    }
    return highContrastSun
      ? 'bg-emerald-600 text-white border-2 border-emerald-800 font-black'
      : 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/60 font-black';
  };

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
  const [burstMode, setBurstMode] = useState<boolean>(false);
  const [learningBadge, setLearningBadge] = useState<string>(
    '🧠 IA Entrenada con etiquetas iMile (Precisión optimizada)'
  );
  const [lastRawOcrText, setLastRawOcrText] = useState<string>('');
  const [lastRotationDeg, setLastRotationDeg] = useState<number>(90);
  const [hasScannedAttempt, setHasScannedAttempt] = useState<boolean>(false);

  const [isListeningVoice, setIsListeningVoice] = useState<boolean>(false);
  const [activeVoiceField, setActiveVoiceField] = useState<'all' | 'tracking' | 'address' | 'recipient' | 'phone' | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'ready'>('idle');
  const [packageSize, setPackageSize] = useState<'small' | 'medium' | 'large'>('medium');

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastDecodedBarcodeRef = useRef<string>('');
  const modalScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const formSectionRef = useRef<HTMLFormElement | null>(null);
  const scannerContainerId = 'miruta-barcode-reader-region';

  const scrollToVerificationForm = () => {
    setTimeout(() => {
      if (formSectionRef.current) {
        formSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (modalScrollContainerRef.current) {
        modalScrollContainerRef.current.scrollTo({ top: 250, behavior: 'smooth' });
      }
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 250, behavior: 'smooth' });
      }
    }, 100);
  };

  const scrollToTopCamera = () => {
    setTimeout(() => {
      if (modalScrollContainerRef.current) {
        modalScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 60);
  };

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

  const refreshLearningStats = async () => {
    await ensureBaselineLearnedPatterns();
    const stats = await getLearningEngineStats();
    setLearningBadge(stats.badgeLabel);
  };

  useEffect(() => {
    if (!isOpen) {
      stopCameraScanner();
      setEditingPackageId(null);
      setIsAnalyzingLabel(false);
      setFrozenFramePreview('');
      setHasScannedAttempt(false);
      lastDecodedBarcodeRef.current = '';
    } else {
      refreshLearningStats();
      // Auto-arranque de cámara trasera a 15fps apenas se abre el modal
      if (activeScannerTab === 'live') {
        startCameraScanner();
      }
    }
    return () => {
      stopCameraScanner();
    };
  }, [isOpen]);

  // Memoria Instantánea (0ms): Si se detecta o digita un teléfono o guía ya conocido, autocompletar en vivo
  useEffect(() => {
    const cleanPhone = normalizeColombianPhone(recipientPhone);
    const cleanTrack = sanitizeTrackingInput(trackingNumber);
    if (cleanPhone.length < 10 && cleanTrack.length < 10) return;
    if (recipientName.trim() && rawAddress.trim()) return;

    let cancelled = false;
    recallFromLearnedMemory({
      trackingNumber: cleanTrack,
      recipientPhone: cleanPhone,
    }).then((match) => {
      if (cancelled || !match || !match.matched) return;
      const flags: AutoFilledFlags = {};
      if (!recipientName.trim() && match.recipientName) {
        setRecipientName(match.recipientName);
        flags.recipientName = true;
      }
      if (!rawAddress.trim() && match.rawAddress) {
        setRawAddress(match.rawAddress);
        flags.rawAddress = true;
      }
      if (!recipientPhone.trim() && match.recipientPhone) {
        const fmt = validateAndFormatColombianPhone(match.recipientPhone);
        setRecipientPhone(fmt.formatted);
        flags.recipientPhone = true;
      }
      if (match.neighborhood) {
        setNeighborhood(match.neighborhood);
      }
      setSmartEngineBadge(match.badgeText);
      setAutoFilledFields((prev) => ({ ...prev, ...flags }));
    });

    return () => {
      cancelled = true;
    };
  }, [trackingNumber, recipientPhone]);

  const startCameraScanner = async () => {
    setCameraError('');
    setFrozenFramePreview('');
    try {
      await stopCameraScanner();
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
            async (decodedText) => {
              const clean = sanitizeTrackingInput(decodedText);
              if (
                clean &&
                clean.length >= 8 &&
                !isAnalyzingLabel &&
                lastDecodedBarcodeRef.current !== clean
              ) {
                lastDecodedBarcodeRef.current = clean;
                playScannerLaserBeep();
                setHasScannedAttempt(true);
                setTrackingNumber(clean);
                setAutoFilledFields((prev) => ({ ...prev, trackingNumber: true }));

                // Consultar en 0ms si la guía ya tiene patrón aprendido en la Memoria de Ruta
                const recalled = await recallFromLearnedMemory({ trackingNumber: clean });
                if (recalled && recalled.matched) {
                  setRecipientName(recalled.recipientName);
                  const fmtPhone = validateAndFormatColombianPhone(recalled.recipientPhone);
                  setRecipientPhone(fmtPhone.formatted);
                  setRawAddress(recalled.rawAddress);
                  setNeighborhood(recalled.neighborhood || 'Medellín');
                  setSmartEngineBadge(recalled.badgeText);
                  setAutoFilledFields({
                    trackingNumber: true,
                    recipientName: true,
                    recipientPhone: true,
                    rawAddress: true,
                  });
                  await stopCameraScanner();
                  scrollToVerificationForm();
                  toast.success(
                    `🔫 BEEP! Guía #${extractLastFourDigits(clean)} reconocida en 0ms`,
                    `${recalled.recipientName} • ${recalled.rawAddress}`
                  );
                } else {
                  scrollToVerificationForm();
                  toast.info(
                    `🔫 BEEP! Guía #${extractLastFourDigits(clean)} leída`,
                    'Pulsa "📸 CAPTURAR ETIQUETA COMPLETA" o verifica la dirección abajo.'
                  );
                }
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
   * Procesa el resultado de `scanIMileLabelSmart` y rellena el formulario con resaltado verde esmeralda,
   * sonido BEEP de pistola láser y auto-guardado si el Modo Ráfaga está activo.
   */
  const applySmartLabelResultToForm = async (
    source: File | Blob | HTMLVideoElement | string
  ) => {
    setIsAnalyzingLabel(true);
    setAnalysisStageText('🔍 Leyendo código de barras y bloque "TO" (0°/90°)...');
    setAnalysisProgress(20);

    // Blindaje contra congelamiento: Si tarda más de 1.5s, cancelar espera de IA y abrir teclado manual
    const timeoutPromise = new Promise<{ isTimeout: true }>((resolve) => {
      setTimeout(() => resolve({ isTimeout: true }), 1500);
    });

    try {
      const scanPromise = scanIMileLabelSmart(source, (stageMsg, pct) => {
        setAnalysisStageText(stageMsg);
        if (pct !== undefined) setAnalysisProgress(pct);
      });

      const raceWinner = await Promise.race([scanPromise, timeoutPromise]);

      if ('isTimeout' in raceWinner) {
        setIsAnalyzingLabel(false);
        setFrozenFramePreview('');
        scrollToVerificationForm();
        toast.warning(
          '⚡ Cámara/IA lenta o etiqueta borrosa',
          'Usa el teclado manual o Smart Paste para registrar sin trabas.'
        );
        return;
      }

      const result = raceWinner;

      setCapturedLabelThumb(result.previewDataUrl);
      setSmartEngineBadge(result.engineBadge);
      setLastRawOcrText(result.rawOcrText || '');
      setLastRotationDeg(result.rotationUsedDeg ?? 90);

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
      setHasScannedAttempt(true);

      if (result.fieldsDetectedCount >= 1) {
        playScannerLaserBeep();
        scrollToVerificationForm();
      }

      if (result.fieldsDetectedCount >= 2) {
        toast.success(
          `🔫 BEEP! Etiqueta #${result.lastFourDigits} leída (${result.durationMs}ms)`,
          `${result.recipientName || 'Cliente'} • ${result.rawAddress || 'Revisa dirección'}`
        );
      } else if (result.trackingNumber) {
        toast.info(
          `🔫 BEEP! Guía #${result.lastFourDigits} detectada`,
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

  const handleToggleVoiceCapture = (field: 'all' | 'tracking' | 'address' | 'recipient' | 'phone' = 'all') => {
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

    if (isListeningVoice && activeVoiceField === field) {
      setIsListeningVoice(false);
      setActiveVoiceField(null);
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recognition = new (SpeechRecognitionAPI as any)();
      recognition.lang = 'es-CO';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      setIsListeningVoice(true);
      setActiveVoiceField(field);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript || '';
        if (transcript) {
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(40);
          }
          playScannerLaserBeep();

          if (field === 'tracking') {
            const cleanDigits = transcript.replace(/\D/g, '');
            if (cleanDigits) {
              setTrackingNumber(cleanDigits);
              setAutoFilledFields((prev) => ({ ...prev, trackingNumber: true }));
              toast.success(`🎙️ Guía dictada: #${cleanDigits.slice(-4)}`);
            } else {
              toast.warning('⚠️ No se reconocieron números de guía');
            }
          } else if (field === 'address') {
            setRawAddress(transcript);
            setAutoFilledFields((prev) => ({ ...prev, rawAddress: true }));
            toast.success('🎙️ Dirección dictada', transcript);
          } else if (field === 'recipient') {
            const cleanName = transcript.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, '').trim();
            setRecipientName(cleanName || transcript);
            setAutoFilledFields((prev) => ({ ...prev, recipientName: true }));
            toast.success('🎙️ Destinatario dictado', cleanName || transcript);
          } else if (field === 'phone') {
            const formatted = validateAndFormatColombianPhone(transcript);
            setRecipientPhone(formatted.formatted);
            setAutoFilledFields((prev) => ({ ...prev, recipientPhone: true }));
            toast.success('🎙️ Celular dictado', formatted.formatted);
          } else {
            // Dictado general de bloque "all"
            setSmartBlockText(transcript);
            applySmartBlockParse(transcript);
            toast.info('🎙️ Texto capturado por voz', transcript);
          }
        }
        setIsListeningVoice(false);
        setActiveVoiceField(null);
      };

      recognition.onerror = () => {
        setIsListeningVoice(false);
        setActiveVoiceField(null);
      };

      recognition.onend = () => {
        setIsListeningVoice(false);
        setActiveVoiceField(null);
      };

      recognition.start();
    } catch {
      setIsListeningVoice(false);
      setActiveVoiceField(null);
    }
  };

  const applySmartBlockParse = (textToParse: string) => {
    const parsed = parseIMileLabelBlock(textToParse);
    const flags: AutoFilledFlags = {};

    if (parsed.trackingNumber) {
      setTrackingNumber(sanitizeTrackingInput(parsed.trackingNumber));
      flags.trackingNumber = true;
    }
    if (parsed.recipientName) {
      setRecipientName(parsed.recipientName);
      flags.recipientName = true;
    }
    if (parsed.recipientPhone) {
      const formattedPhone = validateAndFormatColombianPhone(parsed.recipientPhone);
      setRecipientPhone(formattedPhone.formatted);
      flags.recipientPhone = true;
    }
    if (parsed.rawAddress) {
      setRawAddress(parsed.rawAddress);
      flags.rawAddress = true;
    }

    setAutoFilledFields((prev) => ({ ...prev, ...flags }));
    setHasScannedAttempt(true);
    scrollToVerificationForm();

    const filledCount = Object.keys(flags).length;
    if (filledCount >= 1) {
      playScannerLaserBeep();
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(40);
      }
      toast.success(
        `📋 Smart Paste: ${filledCount} campo(s) distribuidos`,
        `${parsed.recipientName || 'Cliente'} • ${parsed.rawAddress || ''}`
      );
    }
  };

  const handleSmartClipboardPaste = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
        const clipText = await navigator.clipboard.readText();
        if (clipText && clipText.trim()) {
          setSmartBlockText(clipText.trim());
          applySmartBlockParse(clipText.trim());
          return;
        }
      }
      toast.info('📋 Pega el texto copiado en la caja de Smart Paste');
    } catch {
      toast.info('📋 Pega directamente con tu teclado en la caja de Smart Paste');
    }
  };

  const handleLoadDuplicateForUpdate = (pkg: DeliveryPackage) => {
    setEditingPackageId(pkg.id ?? null);
    setTrackingNumber(pkg.trackingNumber);
    setRecipientName(pkg.recipientName);
    setRecipientPhone(validateAndFormatColombianPhone(pkg.recipientPhone).formatted);
    setRawAddress(pkg.rawAddress);
    setNeighborhood(pkg.parsedAddress?.neighborhood || 'Medellín');
    setPackageSize(pkg.packageSize || 'medium');
    toast.info(
      `✏️ Editando guía #${pkg.lastFourDigits}`,
      'Actualiza los datos y guarda sin duplicar el paquete.'
    );
  };

  const parsedAddressPreview = parseMedellinAddress(rawAddress, neighborhood);
  const isAddressComplete =
    parsedAddressPreview.mainNum > 0 && parsedAddressPreview.secNum > 0;
  const medellinIntel = React.useMemo(
    () => inferMedellinComunaAndNormalizeAddress(rawAddress, neighborhood),
    [rawAddress, neighborhood]
  );
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

    // Hotfix v8.3: Cero bloqueos silenciosos ni trampas de validación.
    // Si la guía está vacía o incompleta, autogenerar guía provisional de emergencia.
    const cleanTrack = sanitizeTrackingInput(trackingNumber);
    let finalTracking = cleanTrack;
    let isAutoProvisional = false;

    if (!finalTracking || finalTracking.length < 4) {
      const nowTs = Date.now();
      const lastDigits = String(nowTs).slice(-6);
      finalTracking = `GUIA-MANUAL-${lastDigits}`;
      isAutoProvisional = true;
      toast.warning(
        `⚠️ Guía Provisional Generada (#${lastDigits.slice(-4)})`,
        'Guarda sin trabas. Podrás editarla después en la lista de ruta.'
      );
    }

    // Dirección con fallback automático para jamás bloquear el guardado
    const addressToSave = rawAddress.trim() || 'Dirección Manual por Ingresar';

    try {
      const shiftId = getTodayShiftId();
      await ensureShiftExists(shiftId);

      const parsedAddr = parseMedellinAddress(addressToSave, neighborhood);

      if (editingPackageId) {
        const existingPkg = await db.packages.get(editingPackageId);
        if (existingPkg) {
          const updatedPkg: DeliveryPackage = {
            ...existingPkg,
            trackingNumber: finalTracking,
            lastFourDigits: extractLastFourDigits(finalTracking),
            recipientName: recipientName.trim() || 'Cliente Sin Nombre',
            recipientPhone: normalizeColombianPhone(recipientPhone) || '573000000000',
            rawAddress: addressToSave,
            parsedAddress: parsedAddr,
            packageSize: packageSize,
          };
          updatedPkg.coordinates = estimateMedellinCoordinatesFromAddress(updatedPkg);
          await db.packages.put(updatedPkg);
          toast.success(
            `✅ Guía #${updatedPkg.lastFourDigits} actualizada`,
            updatedPkg.rawAddress
          );
        }
      } else {
        const existingToday = await db.packages.where('shiftId').equals(shiftId).toArray();
        const maxOrder = existingToday.reduce((max, p) => Math.max(max, p.routeOrder || 0), 0);

        const newPkg: DeliveryPackage = {
          trackingNumber: finalTracking,
          lastFourDigits: extractLastFourDigits(finalTracking),
          recipientName: recipientName.trim() || 'Cliente Sin Nombre',
          recipientPhone: normalizeColombianPhone(recipientPhone) || '573000000000',
          rawAddress: addressToSave,
          parsedAddress: parsedAddr,
          coordinates: null,
          routeOrder: maxOrder + 1,
          status: 'pending',
          issueNote: isAutoProvisional ? 'Guía provisional autogenerada en calle' : '',
          rate: getDefaultPackageRate(),
          shiftId,
          scannedAt: Date.now(),
          archivedInHistory: false,
          packageSize: packageSize,
        };
        newPkg.coordinates = estimateMedellinCoordinatesFromAddress(newPkg);

        await db.packages.add(newPkg);
        toast.success(
          `⚡ Guardado #${newPkg.lastFourDigits}`,
          newPkg.rawAddress
        );
      }

      // Feedback táctil y auditivo inmediato
      playScannerLaserBeep();
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([60, 40, 60]);
      }

      // Tareas secundarias en segundo plano (Fire-and-forget: NUNCA bloquean la UI ni la cámara)
      setTimeout(() => {
        learnFromConfirmedPackage({
          trackingNumber: finalTracking,
          recipientName: recipientName.trim() || 'Cliente Sin Nombre',
          recipientPhone,
          rawAddress: addressToSave,
          rawOcrAttempt: lastRawOcrText,
          rotationUsedDeg: lastRotationDeg,
        }).catch(() => {});
        syncToSupabase(true).catch(() => {});
      }, 0);

      // Limpieza instantánea del formulario
      setSaveState('idle');
      setEditingPackageId(null);
      setTrackingNumber('');
      setRecipientName('');
      setRecipientPhone('');
      setRawAddress('');
      setPackageSize('medium');
      setSmartBlockText('');
      setCapturedLabelThumb('');
      setAutoFilledFields({});
      setSmartEngineBadge('');
      setHasScannedAttempt(false);
      lastDecodedBarcodeRef.current = '';

      // Incremento del Contador de Sesión en Vivo y Total Global (v10.2)
      const nextSessionCount = sessionCount + 1;
      setSessionCount(nextSessionCount);

      const newTotalPendingCount = await refreshTotalPendingCount();

      // Disparador a los 20 Paquetes por Carga Total (Freno a los 20)
      if (newTotalPendingCount === 20) {
        stopCameraScanner();
        setShowCapacityAlert(true);
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([100, 50, 100, 50, 150]);
        }
        return;
      }

      if (!keepOpenForNext) {
        onClose();
      } else {
        // En ráfaga o continuar: reiniciar cámara inmediatamente sin esperas
        setActiveScannerTab('live');
        scrollToTopCamera();
        startCameraScanner();
      }
    } catch (err) {
      console.error('Error crítico de guardado:', err);
      setSaveState('idle');
      toast.error('⚠️ Error guardando localmente. Reintentando...');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4 touch-scroll-y">
      <div
        ref={modalScrollContainerRef}
        className={`w-full max-w-lg rounded-t-3xl sm:rounded-3xl border p-4 pb-10 shadow-2xl max-h-[92dvh] touch-scroll-y ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-950'
            : 'bg-slate-900 border-slate-800 text-slate-50'
        }`}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between pb-2.5 border-b border-slate-800/60 gap-2">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <div className="p-2 rounded-xl bg-gradient-to-br from-blue-600 to-emerald-600 text-white shrink-0">
              <PackagePlus className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-black whitespace-normal break-words leading-snug">
                  {editingPackageId
                    ? 'Actualizar Guía en Ruta'
                    : '📸 Escáner Láser + IA'}
                </h2>
                {/* Badge Contador Global de Carga y Límite Real v10.2 */}
                <div
                  className={`px-2.5 py-0.5 rounded-full text-[11px] sm:text-xs border flex items-center gap-1 shadow-sm transition-all ${getSessionBadgeClasses(
                    totalPendingCount
                  )}`}
                >
                  <span>📦 Carga Total: {totalPendingCount} / 20 ({sessionCount} nuevos)</span>
                </div>
              </div>
              <p className="text-[10px] font-bold text-emerald-400 whitespace-normal break-words leading-snug mt-0.5">
                {learningBadge}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setBurstMode((prev) => !prev)}
              className={`px-2 py-1.5 rounded-xl font-black text-[10px] flex items-center gap-1 border transition-all ${
                burstMode
                  ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-md'
                  : 'bg-slate-800 text-slate-300 border-slate-700'
              }`}
              title="Modo Ráfaga: Guarda y prepara el siguiente paquete automáticamente"
            >
              <Zap className="w-3 h-3" />
              <span>Ráfaga {burstMode ? 'ON' : 'OFF'}</span>
            </button>
            {onOpenTestLab && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenTestLab();
                }}
                className="px-2 py-1.5 rounded-xl bg-purple-600/20 border border-purple-500/40 text-purple-300 font-black text-[10px] flex items-center gap-1"
              >
                <FlaskConical className="w-3 h-3" />
                <span>Lab</span>
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

        {/* Botón Destacado Permanente: ✍️ Ingresar Datos Manualmente (Cero Bloqueos) */}
        <div className="mt-2.5">
          <button
            type="button"
            onClick={scrollToVerificationForm}
            className="w-full py-2.5 px-3 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 border border-amber-300 active:scale-[0.99] transition-all cursor-pointer"
          >
            <Edit3 className="w-4 h-4 stroke-[2.5]" />
            <span>✍️ INGRESAR DATOS MANUALMENTE (MODO EXPRESS TECLADO / VOZ)</span>
          </button>
        </div>

        {/* Selector de Modos de Cámara Inteligente Full-Label (Pestaña A vs Pestaña B) */}
        <div className="mt-2.5 grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-slate-950/90 border border-slate-800">
          <button
            type="button"
            onClick={() => {
              setActiveScannerTab('live');
              startCameraScanner();
            }}
            className={`py-2 px-2.5 rounded-xl text-[11px] font-black flex items-center justify-center gap-1.5 transition-all ${
              activeScannerTab === 'live'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ScanLine className="w-3.5 h-3.5 shrink-0" />
            <span>⚡ Escáner En Vivo (Auto-Beep)</span>
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
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
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
              <div className="min-w-0 flex-1">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/25 text-emerald-300 border border-emerald-400/40">
                  ✨ Autocompletado por Cámara Inteligente
                </span>
                <p className="text-[11px] text-slate-300 font-semibold mt-0.5 whitespace-normal break-words leading-snug">
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

        {/* Caja Mágica "Smart Paste" (Pegado de Bloque Completo + Dictado de Voz) */}
        <div
          className={`mt-3 p-3 rounded-2xl border-2 transition-all ${
            highContrastSun
              ? 'bg-amber-50/80 border-amber-400 text-slate-950'
              : 'bg-slate-950 border-amber-500/60 text-slate-100 shadow-lg'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
            <span className="text-[11px] font-black uppercase flex items-center gap-1.5 text-amber-400">
              <ClipboardPaste className="w-4 h-4 text-amber-400" />
              <span>📋 Smart Paste (Pegar Bloque Completo)</span>
            </span>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleSmartClipboardPaste}
                className="px-2.5 py-1 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[10px] flex items-center gap-1 active:scale-95 shadow-sm"
              >
                <ClipboardPaste className="w-3 h-3" />
                <span>Pegar Portapapeles</span>
              </button>

              <button
                type="button"
                onClick={() => handleToggleVoiceCapture('all')}
                className={`px-2.5 py-1 rounded-xl text-[10px] font-black flex items-center gap-1 transition-all ${
                  isListeningVoice
                    ? 'bg-rose-600 text-white animate-pulse'
                    : 'bg-slate-800 text-slate-200 border border-slate-700'
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
                    <span>Dictar</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <textarea
            rows={2}
            value={smartBlockText}
            onChange={(e) => {
              setSmartBlockText(e.target.value);
              applySmartBlockParse(e.target.value);
            }}
            placeholder="Pega aquí cualquier bloque copiado de WhatsApp o la orden. Detecta automáticamente Guía 610..., Celular 573..., Dirección y Nombre sin IA."
            className={`w-full rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none ${
              highContrastSun
                ? 'bg-white border-slate-300 text-slate-950'
                : 'bg-slate-900 border-slate-700 text-white'
            }`}
          />
        </div>

        {/* Claridad Arquitectónica: Motor Local Autónomo iMile */}
        <div className="px-3 py-1.5 rounded-xl bg-slate-900/60 border border-slate-800 text-[10px] text-slate-400 flex items-center justify-between gap-1.5 flex-wrap">
          <span className="flex items-center gap-1 font-semibold">
            ⚡ Motor Local Híbrido iMile: Barcode Nativo + OCR Local + Smart Paste + Nomenclatura Medellín
          </span>
          <span className="font-mono text-emerald-400 font-bold">100% Offline • 0ms Latencia</span>
        </div>

        {/* Formulario Vertical Optimizado (1 Columna Compacta space-y-3) con Auto-Scroll y Validación Ámbar */}
        <form
          ref={formSectionRef}
          onSubmit={(e) => handleSavePackage(e, true)}
          className="mt-3 space-y-3"
        >
          {/* 1. Guía iMile + Últimos 4 Dígitos */}
          <div className="grid grid-cols-3 gap-2 items-center">
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                  <Hash className="w-3.5 h-3.5 text-blue-400" />
                  GUÍA IMILE (13 DÍGITOS)
                </label>
                <div className="flex items-center gap-1">
                  {autoFilledFields.trackingNumber && (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      ✨ Auto
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleToggleVoiceCapture('tracking')}
                    className={`p-1 rounded-lg text-[10px] font-bold flex items-center gap-0.5 transition-all ${
                      isListeningVoice && activeVoiceField === 'tracking'
                        ? 'bg-rose-600 text-white animate-pulse'
                        : 'bg-slate-800 text-slate-300 hover:text-white'
                    }`}
                    title="Dictar número de guía"
                  >
                    <Mic className="w-3.5 h-3.5 text-amber-400" />
                    <span className="hidden sm:inline">
                      {isListeningVoice && activeVoiceField === 'tracking' ? 'Escuchando...' : 'Dictar'}
                    </span>
                  </button>
                </div>
              </div>
              <input
                type="text"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(sanitizeTrackingInput(e.target.value))}
                placeholder="Ej: 6103026696672"
                className={`w-full rounded-xl px-3 py-2.5 text-sm font-mono font-bold border focus:outline-none focus:ring-2 transition-colors ${
                  isListeningVoice && activeVoiceField === 'tracking'
                    ? 'border-rose-500 ring-2 ring-rose-500/30'
                    : duplicateTodayPkg
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
              <div className="flex items-start gap-2 min-w-0 flex-1">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-snug whitespace-normal break-words">
                  <p className="font-black text-amber-300">
                    ⚠️ Esta guía (#{duplicateTodayPkg.lastFourDigits}) ya está en tu ruta de hoy
                  </p>
                  <p className="text-amber-200/80 mt-0.5">
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

          {/* 2. Dirección de Entrega con Validación Visual Ámbar de Campos Críticos */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                DIRECCIÓN DE ENTREGA (MEDELLÍN) *
              </label>
              <div className="flex items-center gap-1">
                {autoFilledFields.rawAddress && isAddressComplete ? (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    ✨ Autocompletado
                  </span>
                ) : hasScannedAttempt && (!rawAddress.trim() || !isAddressComplete) ? (
                  <span className="text-[9px] font-black px-2 py-0.5 rounded bg-amber-500/25 text-amber-300 border border-amber-400/60 animate-pulse">
                    ⚠️ Revisa dirección
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleToggleVoiceCapture('address')}
                  className={`p-1 rounded-lg text-[10px] font-bold flex items-center gap-0.5 transition-all ${
                    isListeningVoice && activeVoiceField === 'address'
                      ? 'bg-rose-600 text-white animate-pulse'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                  title="Dictar dirección"
                >
                  <Mic className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">
                    {isListeningVoice && activeVoiceField === 'address' ? 'Escuchando...' : 'Dictar'}
                  </span>
                </button>
              </div>
            </div>

            <input
              type="text"
              value={rawAddress}
              onChange={(e) => setRawAddress(e.target.value)}
              placeholder="Ej: Carrera 43C # 100 - 52"
              className={`w-full rounded-xl px-3 py-2.5 text-sm font-bold border focus:outline-none focus:ring-2 transition-all ${
                isListeningVoice && activeVoiceField === 'address'
                  ? 'border-rose-500 ring-2 ring-rose-500/30'
                  : hasScannedAttempt && (!rawAddress.trim() || !isAddressComplete)
                  ? 'border-amber-400 ring-2 ring-amber-400/30 focus:ring-amber-400'
                  : rawAddress.trim() && isAddressComplete
                  ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-950/20 focus:ring-emerald-500'
                  : 'border-slate-700 focus:ring-blue-500'
              } ${
                highContrastSun
                  ? 'bg-white text-slate-950'
                  : 'bg-slate-950 text-white'
              }`}
            />

            {hasScannedAttempt && !rawAddress.trim() && (
              <div className="mt-1.5 p-2 rounded-xl bg-amber-500/15 border border-amber-400/50 text-[11px] font-black text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>⚠️ Revisa esta dirección antes de guardar</span>
              </div>
            )}

            {rawAddress.trim() && (
              <div
                className={`mt-1.5 p-2.5 rounded-xl border text-[11px] font-bold space-y-1.5 ${
                  isAddressComplete
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                    : 'bg-amber-950/40 border-amber-400/60 text-amber-300'
                }`}
              >
                {isAddressComplete ? (
                  <>
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="whitespace-normal break-words leading-snug">
                        ✅ Normalizado: <strong>{medellinIntel.normalizedAddress}</strong>
                      </span>
                      <span className="font-mono bg-emerald-500/20 px-1.5 py-0.5 rounded text-[10px]">
                        Cuadra: {parsedAddressPreview.blockKey}
                      </span>
                    </div>
                    <div className="flex items-center justify-between flex-wrap gap-1.5 text-[10px] text-slate-300 pt-0.5 border-t border-emerald-500/20">
                      <span className="whitespace-normal break-words leading-snug">
                        📍 Sector inferido: <strong className="text-sky-300">{medellinIntel.inferredNeighborhood}</strong> ({medellinIntel.comunaName})
                      </span>
                      {(rawAddress !== medellinIntel.normalizedAddress ||
                        neighborhood !== medellinIntel.inferredNeighborhood) && (
                        <button
                          type="button"
                          onClick={() => {
                            setRawAddress(medellinIntel.normalizedAddress);
                            setNeighborhood(medellinIntel.inferredNeighborhood);
                          }}
                          className="px-2 py-0.5 rounded-lg bg-emerald-500 text-slate-950 font-black text-[10px]"
                        >
                          ✨ Aplicar Normalización IA
                        </button>
                      )}
                    </div>
                    <p
                      className={`text-[10px] font-semibold whitespace-normal break-words leading-snug ${
                        medellinIntel.isSteepHillOrAlley ? 'text-amber-300' : 'text-emerald-300/90'
                      }`}
                    >
                      {medellinIntel.terrainWarning}
                    </p>
                  </>
                ) : (
                  <span className="flex items-center gap-1.5 whitespace-normal break-words leading-snug">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>⚠️ Revisa esta dirección antes de guardar (ej. Carrera 43C # 100 - 52)</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 3. Destinatario (1 Columna Vertical) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-blue-400" />
                DESTINATARIO (BLOQUE TO)
              </label>
              <div className="flex items-center gap-1">
                {autoFilledFields.recipientName && (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    ✨ Auto
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleToggleVoiceCapture('recipient')}
                  className={`p-1 rounded-lg text-[10px] font-bold flex items-center gap-0.5 transition-all ${
                    isListeningVoice && activeVoiceField === 'recipient'
                      ? 'bg-rose-600 text-white animate-pulse'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                  title="Dictar nombre de destinatario"
                >
                  <Mic className="w-3.5 h-3.5 text-blue-400" />
                  <span className="hidden sm:inline">
                    {isListeningVoice && activeVoiceField === 'recipient' ? 'Escuchando...' : 'Dictar'}
                  </span>
                </button>
              </div>
            </div>
            <input
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Alba Lucia Lopera Castrillon"
              className={`w-full rounded-xl px-3 py-2 text-sm font-medium border focus:outline-none focus:ring-2 transition-colors ${
                isListeningVoice && activeVoiceField === 'recipient'
                  ? 'border-rose-500 ring-2 ring-rose-500/30'
                  : recipientName.trim().length >= 3
                  ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-950/20 focus:ring-emerald-500'
                  : 'border-slate-700 focus:ring-blue-500'
              } ${
                highContrastSun
                  ? 'bg-white text-slate-950'
                  : 'bg-slate-950 text-white'
              }`}
            />
          </div>

          {/* 4. Celular WhatsApp (1 Columna Vertical con Validación Ámbar) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                <Phone className="w-3.5 h-3.5 text-emerald-400" />
                CELULAR WHATSAPP (573...)
              </label>
              <div className="flex items-center gap-1">
                {autoFilledFields.recipientPhone && phoneValidation.isValid ? (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    ✨ Auto
                  </span>
                ) : hasScannedAttempt && (!recipientPhone.trim() || !phoneValidation.isValid) ? (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-400/50">
                    ⚠️ Verifica
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleToggleVoiceCapture('phone')}
                  className={`p-1 rounded-lg text-[10px] font-bold flex items-center gap-0.5 transition-all ${
                    isListeningVoice && activeVoiceField === 'phone'
                      ? 'bg-rose-600 text-white animate-pulse'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                  title="Dictar celular"
                >
                  <Mic className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">
                    {isListeningVoice && activeVoiceField === 'phone' ? 'Escuchando...' : 'Dictar'}
                  </span>
                </button>
              </div>
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
              className={`w-full rounded-xl px-3 py-2 text-sm font-mono font-bold border focus:outline-none focus:ring-2 transition-all ${
                isListeningVoice && activeVoiceField === 'phone'
                  ? 'border-rose-500 ring-2 ring-rose-500/30'
                  : (recipientPhone && !phoneValidation.isValid) ||
                    (hasScannedAttempt && !recipientPhone.trim())
                  ? 'border-amber-400 ring-2 ring-amber-400/30 focus:ring-amber-400'
                  : recipientPhone && phoneValidation.isValid
                  ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-950/20 focus:ring-emerald-500'
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

          {/* 5. Barrio / Sector Asignado */}
          <div>
            <label className="block text-[11px] font-bold text-slate-400 mb-1">
              BARRIO / SECTOR ASIGNADO
            </label>
            <input
              type="text"
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              placeholder="Ej: Santa Cruz / El Poblado / Laureles / Belén"
              className={`w-full rounded-xl px-3 py-2 text-xs font-bold border ${
                highContrastSun
                  ? 'bg-white border-slate-300 text-slate-950'
                  : 'bg-slate-950 border-slate-700 text-white'
              }`}
            />
          </div>

          {/* 6. Tamaño / Volumen en Moto (Filtro para Tandas de Carga v8.1) */}
          <div>
            <label className="block text-[11px] font-bold text-slate-400 mb-1">
              🛵 TAMAÑO / VOLUMEN EN MOTO (CAPACIDAD)
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => setPackageSize('small')}
                className={`py-2 px-2 rounded-xl text-xs font-black border transition-all flex flex-col items-center justify-center gap-0.5 ${
                  packageSize === 'small'
                    ? 'bg-blue-600 text-white border-blue-400 shadow-md'
                    : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <span>🎒 Pequeño</span>
                <span className="text-[9px] font-normal opacity-80">Morral / Bolsillo</span>
              </button>

              <button
                type="button"
                onClick={() => setPackageSize('medium')}
                className={`py-2 px-2 rounded-xl text-xs font-black border transition-all flex flex-col items-center justify-center gap-0.5 ${
                  packageSize === 'medium'
                    ? 'bg-emerald-600 text-white border-emerald-400 shadow-md'
                    : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <span>📦 Mediano</span>
                <span className="text-[9px] font-normal opacity-80">Tanda Normal</span>
              </button>

              <button
                type="button"
                onClick={() => setPackageSize('large')}
                className={`py-2 px-2 rounded-xl text-xs font-black border transition-all flex flex-col items-center justify-center gap-0.5 ${
                  packageSize === 'large'
                    ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-md'
                    : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <span>⚠️ Bulto Grande</span>
                <span className="text-[9px] font-black opacity-90">1ra Tanda Prioritaria</span>
              </button>
            </div>
          </div>

          {/* Botón Único Principal Gigante e Imponente (1-Touch Flow Modo Bala) + Enlace Sutil Secundario */}
          <div className="pt-2 space-y-2.5">
            <button
              type="submit"
              className="w-full py-4 px-5 rounded-2xl bg-gradient-to-r from-emerald-500 via-emerald-600 to-green-600 hover:from-emerald-400 hover:to-green-500 text-slate-950 font-black text-base shadow-xl shadow-emerald-600/30 border-2 border-emerald-300 active:scale-[0.98] flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Zap className="w-5 h-5 fill-slate-950 shrink-0" />
              {editingPackageId ? (
                <span>⚡ ACTUALIZAR Y ESCANEAR OTRO</span>
              ) : (
                <span>⚡ GUARDAR Y ESCANEAR OTRO</span>
              )}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={onClose}
                className="py-1.5 px-4 text-xs font-bold text-slate-400 hover:text-white transition-colors"
              >
                ✕ Volver a ruta sin guardar
              </button>
            </div>
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

      {/* Modal / Alerta de Decisión de Capacidad de Moto (v9.8) */}
      {showCapacityAlert && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div
            className={`w-full max-w-sm rounded-3xl border-2 p-5 shadow-2xl text-center space-y-4 ${
              highContrastSun
                ? 'bg-white border-amber-500 text-slate-950'
                : 'bg-slate-900 border-amber-500/80 text-white shadow-amber-500/20'
            }`}
          >
            <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border-2 border-amber-400 flex items-center justify-center mx-auto text-amber-400 text-3xl">
              ⚠️
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-black text-amber-400 flex items-center justify-center gap-1.5">
                <span>⚠️ Capacidad Máxima de Moto Alcanzada</span>
              </h3>
              <p className="text-xs sm:text-sm font-semibold text-slate-300 leading-snug">
                Con este paquete, tu ruta llega a <strong className="text-amber-300 font-black">20 entregas en total</strong> (contando pendientes de días anteriores). ¿Deseas enrutar y arrancar ya, o seguirás escaneando para una segunda tanda en bodega?
              </p>
            </div>

            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowCapacityAlert(false);
                  onClose();
                  onNavigateToRoute?.();
                }}
                className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 via-emerald-600 to-green-600 hover:from-emerald-400 hover:to-green-500 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-xl shadow-emerald-500/30 active:scale-95 transition-transform cursor-pointer border border-emerald-300"
              >
                <span>🏁 Terminar y Enrutar</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowCapacityAlert(false);
                  setActiveScannerTab('live');
                  scrollToTopCamera();
                  startCameraScanner();
                }}
                className="w-full py-3 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-extrabold text-xs flex items-center justify-center gap-2 border border-slate-700 active:scale-95 transition-transform cursor-pointer"
              >
                <span>🔄 Seguir Escaneando</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
