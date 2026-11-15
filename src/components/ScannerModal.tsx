import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Html5Qrcode } from 'html5-qrcode';
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
import { syncToSupabase } from '../services/supabaseSync';
import { useToast } from './ui/FeedbackSystem';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenTestLab?: () => void;
  highContrastSun: boolean;
}

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  onOpenTestLab,
  highContrastSun,
}) => {
  const toast = useToast();

  const [trackingNumber, setTrackingNumber] = useState<string>('');
  const [recipientName, setRecipientName] = useState<string>('');
  const [recipientPhone, setRecipientPhone] = useState<string>('');
  const [rawAddress, setRawAddress] = useState<string>('');
  const [neighborhood, setNeighborhood] = useState<string>('Medellín');
  const [smartBlockText, setSmartBlockText] = useState<string>('');
  const [editingPackageId, setEditingPackageId] = useState<number | null>(null);

  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>('');
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
    }
    return () => {
      stopCameraScanner();
    };
  }, [isOpen]);

  const startCameraScanner = async () => {
    setCameraError('');
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
              if (clean) {
                setTrackingNumber(clean);
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                  navigator.vibrate(90);
                }
                toast.success(`📷 Guía #${extractLastFourDigits(clean)} capturada`);
                stopCameraScanner();
              }
            },
            () => {
              // Ignorar frames sin código
            }
          );
        } catch (err) {
          setCameraError(
            err instanceof Error
              ? `No se pudo abrir cámara en Android/iOS: ${err.message}`
              : 'Permiso de cámara denegado o sin lente trasero disponible.'
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
    }
    if (parsed.recipientName) setRecipientName(parsed.recipientName);
    if (parsed.recipientPhone) {
      const formattedPhone = validateAndFormatColombianPhone(parsed.recipientPhone);
      setRecipientPhone(formattedPhone.formatted);
    }
    if (parsed.rawAddress) setRawAddress(parsed.rawAddress);
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

  const handleSavePackage = async (e: React.FormEvent, keepOpenForNext = true) => {
    e.preventDefault();

    const cleanTrack = sanitizeTrackingInput(trackingNumber);
    if (cleanTrack.length > 0 && cleanTrack.length < 6) {
      toast.error(
        '⚠️ La guía debe tener al menos 6 caracteres válidos',
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
        'Pulsa "Cargar para actualizar" en el aviso amarillo para no duplicarla.'
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
        className={`w-full max-w-lg rounded-t-3xl sm:rounded-3xl border p-4 shadow-2xl max-h-[92vh] overflow-y-auto ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-950'
            : 'bg-slate-900 border-slate-800 text-slate-50'
        }`}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/60 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 rounded-xl bg-blue-600 text-white shrink-0">
              <PackagePlus className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black leading-tight truncate">
                {editingPackageId ? 'Actualizar Guía en Ruta' : 'Escanear Guía en MiRuta'}
              </h2>
              <p className="text-xs text-slate-400">
                Tarifa activa: {formatCOP(activeDefaultRate)} COP • 100% Offline
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

        {/* Camera Barcode Scanner Section */}
        <div className="mt-3">
          {!cameraActive ? (
            <button
              type="button"
              onClick={startCameraScanner}
              className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 active:scale-[0.99]"
            >
              <Camera className="w-5 h-5" />
              <span>ESCANEAR CÓDIGO DE BARRAS / QR CON CÁMARA</span>
            </button>
          ) : (
            <div className="rounded-2xl overflow-hidden border-2 border-blue-500 bg-black relative">
              <div id={scannerContainerId} className="w-full min-h-[190px]" />
              <button
                type="button"
                onClick={stopCameraScanner}
                className="w-full py-2.5 bg-rose-600 text-white font-bold text-xs flex items-center justify-center gap-1.5"
              >
                <CameraOff className="w-4 h-4" />
                <span>Cerrar Cámara</span>
              </button>
            </div>
          )}
          {cameraError && (
            <p className="mt-1.5 text-xs font-semibold text-rose-400">{cameraError}</p>
          )}
        </div>

        {/* Fast Voice / OCR Block Capture ("TO" Block) */}
        <div
          className={`mt-3 p-3 rounded-2xl border ${
            highContrastSun
              ? 'bg-slate-50 border-slate-300'
              : 'bg-slate-950/80 border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-xs font-extrabold flex items-center gap-1 text-blue-400">
              <Sparkles className="w-3.5 h-3.5" />
              Captura Rápida Bloque &quot;TO&quot; (Voz o Pegar Texto)
            </span>
            <button
              type="button"
              onClick={handleToggleVoiceCapture}
              className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                isListeningVoice
                  ? 'bg-rose-600 text-white animate-pulse'
                  : 'bg-emerald-600 text-white'
              }`}
            >
              {isListeningVoice ? (
                <>
                  <MicOff className="w-3.5 h-3.5" />
                  <span>Escuchando...</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5" />
                  <span>Dictar por Voz</span>
                </>
              )}
            </button>
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={smartBlockText}
              onChange={(e) => {
                setSmartBlockText(e.target.value);
                applySmartBlockParse(e.target.value);
              }}
              placeholder="Ej: Alba Lucia Lopera 573225873762 Carrera 43c #100 52"
              className={`w-full rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                highContrastSun
                  ? 'bg-white border-slate-300 text-slate-950'
                  : 'bg-slate-900 border-slate-700 text-white'
              }`}
            />
          </div>
        </div>

        {/* Manual / Assisted Form */}
        <form onSubmit={(e) => handleSavePackage(e, true)} className="mt-3 space-y-3">
          <div className="grid grid-cols-3 gap-2 items-center">
            <div className="col-span-2">
              <label className="block text-[11px] font-bold text-slate-400 mb-1 flex items-center gap-1">
                <Hash className="w-3.5 h-3.5 text-blue-400" />
                GUÍA IMILE (MÍN. 6 CARACTERES)
              </label>
              <input
                type="text"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(sanitizeTrackingInput(e.target.value))}
                placeholder="Ej: 6103026696672"
                className={`w-full rounded-xl px-3 py-2.5 text-sm font-mono font-bold border focus:outline-none focus:ring-2 ${
                  duplicateTodayPkg
                    ? 'border-amber-500 focus:ring-amber-500'
                    : trackingNumber.length > 0 && trackingNumber.length < 6
                    ? 'border-rose-500 focus:ring-rose-500'
                    : 'border-slate-700 focus:ring-blue-500'
                } ${
                  highContrastSun
                    ? 'bg-white text-slate-950'
                    : 'bg-slate-950 text-white'
                }`}
              />
              {trackingNumber.length > 0 && trackingNumber.length < 6 && (
                <p className="text-[10px] font-bold text-rose-400 mt-1">
                  ⚠️ Mínimo 6 caracteres alfanuméricos ({trackingNumber.length}/6)
                </p>
              )}
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
            <label className="block text-[11px] font-bold text-slate-400 mb-1 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-emerald-400" />
              DIRECCIÓN DE ENTREGA (MEDELLÍN) *
            </label>
            <input
              type="text"
              required
              value={rawAddress}
              onChange={(e) => setRawAddress(e.target.value)}
              placeholder="Ej: Carrera 43c #100 52 Apto 301"
              className={`w-full rounded-xl px-3 py-2.5 text-sm font-bold border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                highContrastSun
                  ? 'bg-white border-slate-300 text-slate-950'
                  : 'bg-slate-950 border-slate-700 text-white'
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
              <label className="block text-[11px] font-bold text-slate-400 mb-1 flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-blue-400" />
                DESTINATARIO (BLOQUE TO)
              </label>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Alba Lucia Lopera Castrillon"
                className={`w-full rounded-xl px-3 py-2 text-sm font-medium border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  highContrastSun
                    ? 'bg-white border-slate-300 text-slate-950'
                    : 'bg-slate-950 border-slate-700 text-white'
                }`}
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-400 mb-1 flex items-center gap-1">
                <Phone className="w-3.5 h-3.5 text-emerald-400" />
                CELULAR WHATSAPP (COLOMBIA)
              </label>
              <input
                type="tel"
                inputMode="tel"
                value={recipientPhone}
                onChange={(e) => {
                  const res = validateAndFormatColombianPhone(e.target.value);
                  setRecipientPhone(res.formatted);
                }}
                placeholder="322 587 3762"
                className={`w-full rounded-xl px-3 py-2 text-sm font-mono font-bold border focus:outline-none focus:ring-2 ${
                  recipientPhone && !phoneValidation.isValid
                    ? 'border-amber-500 focus:ring-amber-500'
                    : recipientPhone && phoneValidation.isValid
                    ? 'border-emerald-500 focus:ring-emerald-500'
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
                <span>+ GUARDAR Y ESCANEAR OTRO</span>
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
    </div>
  );
};
