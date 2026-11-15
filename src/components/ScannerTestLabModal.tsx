import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  FlaskConical,
  Zap,
  Camera,
  CameraOff,
  Rocket,
  Trash2,
  CheckCircle2,
  X,
  Clock,
  Barcode,
  Sparkles,
  Loader2,
  ImagePlus
} from 'lucide-react';
import { extractLastFourDigits } from '../db/database';
import { parseIMileLabelBlock, parseMedellinAddress } from '../utils/addressParser';
import {
  seedStressTest40Packages,
  clearStressTestPackages,
  type StressTestMetrics
} from '../utils/demoSeeder';
import {
  scanIMileLabelSmart,
  type SmartLabelScanResult
} from '../services/smartLabelScanner';
import { useToast } from './ui/FeedbackSystem';

interface ScannerTestLabModalProps {
  isOpen: boolean;
  onClose: () => void;
  highContrastSun: boolean;
}

interface UnitTestResult {
  passed: boolean;
  durationMs: string;
  barcode: string;
  extractedLast4: string;
  extractedName: string;
  extractedPhone: string;
  extractedRawAddress: string;
  parsedNomenclature: string;
  blockKey: string;
}

interface CameraBenchmarkResult {
  decodedText: string;
  formatName: string;
  decodeTimeMs: number;
  timestamp: string;
}

export const ScannerTestLabModal: React.FC<ScannerTestLabModalProps> = ({
  isOpen,
  onClose,
  highContrastSun
}) => {
  const toast = useToast();
  const [unitResult, setUnitResult] = useState<UnitTestResult | null>(null);
  const [photoScanResult, setPhotoScanResult] = useState<SmartLabelScanResult | null>(null);
  const [isScanningPhoto, setIsScanningPhoto] = useState<boolean>(false);
  const [photoScanStage, setPhotoScanStage] = useState<string>('');
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraBenchmark, setCameraBenchmark] = useState<CameraBenchmarkResult | null>(null);
  const [cameraError, setCameraError] = useState<string>('');
  const [stressMetrics, setStressMetrics] = useState<StressTestMetrics | null>(null);
  const [statusBanner, setStatusBanner] = useState<string>('');
  const [isRunningStress, setIsRunningStress] = useState<boolean>(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scanStartTimestampRef = useRef<number>(0);
  const benchmarkContainerId = 'miruta-benchmark-camera-region';

  useEffect(() => {
    if (!isOpen) {
      stopBenchmarkCamera();
    }
    return () => {
      stopBenchmarkCamera();
    };
  }, [isOpen]);

  // 1. Test Unitario en Vivo con Etiqueta Real iMile (6103026696672)
  const handleRunIMileLabelTest = () => {
    const t0 = performance.now();
    const rawBarcode = '6103026696672';
    const rawBlockTO =
      'alba lucia lopera castrillon / 573225873762 / carrera 43c #100 52 MEDELLIN ANTIOQUIA';

    const last4 = extractLastFourDigits(rawBarcode);
    const parsedBlock = parseIMileLabelBlock(rawBlockTO);
    const parsedAddr = parseMedellinAddress(parsedBlock.rawAddress || '', 'Medellín');
    const durationMs = (performance.now() - t0).toFixed(2);

    const formattedNomenclature = `${parsedAddr.mainType} ${parsedAddr.mainNum}${parsedAddr.mainLetter} # ${parsedAddr.secNum}${parsedAddr.secLetter} - ${parsedAddr.plate}`;

    const passed =
      last4 === '6672' &&
      (parsedBlock.recipientName || '').toLowerCase().includes('alba lucia lopera') &&
      parsedBlock.recipientPhone === '573225873762' &&
      parsedAddr.mainType === 'CR' &&
      parsedAddr.mainNum === 43 &&
      parsedAddr.mainLetter === 'C' &&
      parsedAddr.secNum === 100 &&
      parsedAddr.plate === 52;

    setUnitResult({
      passed,
      durationMs,
      barcode: rawBarcode,
      extractedLast4: last4,
      extractedName: parsedBlock.recipientName || 'N/A',
      extractedPhone: `+${parsedBlock.recipientPhone || ''}`,
      extractedRawAddress: parsedBlock.rawAddress || '',
      parsedNomenclature: formattedNomenclature,
      blockKey: parsedAddr.blockKey
    });

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(60);
    }
  };

  // 1B. Test en Vivo Subiendo una Foto Real de Etiqueta iMile desde Galería / Cámara
  const handleGalleryLabelPhotoTest = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsScanningPhoto(true);
    setPhotoScanResult(null);
    setPhotoScanStage('🔍 Analizando foto de etiqueta iMile...');

    try {
      const result = await scanIMileLabelSmart(file, (stageMsg) => {
        setPhotoScanStage(stageMsg);
      });
      setPhotoScanResult(result);
      toast.success(
        `✨ Etiqueta analizada en ${result.durationMs} ms`,
        `Guía #${result.lastFourDigits} • ${result.recipientName || 'Sin nombre'} • ${result.rawAddress || 'Sin dirección'}`
      );
    } catch (err) {
      toast.error(
        '⚠️ Error procesando foto de prueba',
        err instanceof Error ? err.message : 'Intenta con otra imagen.'
      );
    } finally {
      setIsScanningPhoto(false);
      setPhotoScanStage('');
      e.target.value = '';
    }
  };

  // 2. Benchmark de Velocidad de Cámara y Lector (Barcode Speed Test)
  const startBenchmarkCamera = async () => {
    setCameraError('');
    setCameraBenchmark(null);
    setCameraActive(true);

    setTimeout(async () => {
      try {
        const qr = new Html5Qrcode(benchmarkContainerId);
        scannerRef.current = qr;
        scanStartTimestampRef.current = performance.now();

        await qr.start(
          { facingMode: 'environment' },
          {
            fps: 20,
            qrbox: { width: 260, height: 115 }
          },
          (decodedText, decodedResult) => {
            const elapsedMs = Math.round(performance.now() - scanStartTimestampRef.current);
            const formatName =
              decodedResult?.result?.format?.formatName || 'CODE_128 / BARCODE';

            setCameraBenchmark({
              decodedText: decodedText.trim(),
              formatName,
              decodeTimeMs: elapsedMs,
              timestamp: new Date().toLocaleTimeString('es-CO')
            });

            if (typeof navigator !== 'undefined' && navigator.vibrate) {
              navigator.vibrate([50, 30, 80]);
            }
            stopBenchmarkCamera();
          },
          () => {
            // Frame en búsqueda
          }
        );
      } catch (err) {
        setCameraError(
          err instanceof Error
            ? `No se pudo iniciar cámara: ${err.message}`
            : 'Permiso de cámara no disponible.'
        );
        setCameraActive(false);
      }
    }, 150);
  };

  const stopBenchmarkCamera = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch {
        // Ignorar al cerrar
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
  };

  // 3. Test de Estrés de Base de Datos y Enrutador (40 Paquetes en 1 Click)
  const handleRunStressTest40 = async () => {
    setIsRunningStress(true);
    try {
      const metrics = await seedStressTest40Packages();
      setStressMetrics(metrics);
      setStatusBanner(
        `🚀 40 paquetes insertados y ordenados en Serpiente en solo ${metrics.totalTimeMs} ms. ¡Ve a Modo Piloto o Ruta para probarlos!`
      );
    } finally {
      setIsRunningStress(false);
    }
  };

  const handleCleanTestData = async () => {
    const removed = await clearStressTestPackages();
    setStressMetrics(null);
    setStatusBanner(
      `🧹 Limpieza completada: ${removed} paquete(s) de prueba eliminados. Tus entregas reales permanecen intactas.`
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto">
      <div
        className={`w-full max-w-lg rounded-t-3xl sm:rounded-3xl border p-4 shadow-2xl max-h-[92vh] overflow-y-auto space-y-4 ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-950'
            : 'bg-slate-900 border-slate-800 text-slate-50'
        }`}
      >
        {/* Header del Laboratorio */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-600 text-white">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black leading-tight">
                🧪 Laboratorio de Diagnóstico y Agilidad
              </h2>
              <p className="text-xs text-slate-400">
                Verifica lector de barras, parser iMile Medellín e IndexedDB
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {statusBanner && (
          <div className="p-3 rounded-xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold">
            {statusBanner}
          </div>
        )}

        {/* SECCIÓN 1: SIMULADOR DE ETIQUETA REAL DE IMILE */}
        <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-amber-400 uppercase flex items-center gap-1.5">
              <Zap className="w-4 h-4" />
              1. Simulador de Etiqueta Real iMile (Test Unitario)
            </span>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed font-mono bg-slate-900 p-2 rounded-xl border border-slate-800">
            Barcode: <strong>6103026696672</strong>
            <br />
            TO: &quot;alba lucia lopera castrillon / 573225873762 / carrera 43c #100 52 MEDELLIN ANTIOQUIA&quot;
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleRunIMileLabelTest}
              className="w-full py-3 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-95"
            >
              <Zap className="w-4 h-4 fill-slate-950 shrink-0" />
              <span>⚡ Test Texto Guía #6672</span>
            </button>

            <label className="w-full py-3 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 shadow-md cursor-pointer active:scale-95">
              {isScanningPhoto ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>Analizando...</span>
                </>
              ) : (
                <>
                  <ImagePlus className="w-4 h-4 shrink-0" />
                  <span>📸 Subir Foto Etiqueta Real</span>
                </>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={handleGalleryLabelPhotoTest}
                className="hidden"
              />
            </label>
          </div>

          {isScanningPhoto && (
            <div className="p-2.5 rounded-xl bg-teal-950/60 border border-teal-500/40 text-teal-200 text-xs font-bold flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-teal-400 shrink-0" />
              <span>{photoScanStage || 'Procesando etiqueta...'}</span>
            </div>
          )}

          {photoScanResult && (
            <div className="p-3 rounded-xl bg-teal-950/60 border-2 border-emerald-500/60 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-black text-emerald-300 flex items-center gap-1">
                  <Sparkles className="w-4 h-4" />
                  {photoScanResult.engineBadge}
                </span>
                <span className="font-mono text-[11px] text-amber-300">
                  {photoScanResult.durationMs} ms
                </span>
              </div>

              <div className="flex items-start gap-2.5">
                {photoScanResult.previewDataUrl && (
                  <img
                    src={photoScanResult.previewDataUrl}
                    alt="Foto etiqueta"
                    className="w-16 h-16 rounded-xl object-cover border border-emerald-400 shrink-0"
                  />
                )}
                <div className="grid grid-cols-2 gap-1.5 flex-1 text-[11px]">
                  <div>
                    <span className="text-slate-400 block">Guía / #4 Dígitos:</span>
                    <strong className="font-mono text-amber-400">
                      {photoScanResult.trackingNumber || 'N/A'} (#{photoScanResult.lastFourDigits})
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Celular:</span>
                    <strong className="font-mono text-emerald-300">
                      {photoScanResult.recipientPhone || 'No detectado'}
                    </strong>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400 block">Cliente (TO):</span>
                    <strong className="text-white">
                      {photoScanResult.recipientName || 'No detectado'}
                    </strong>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400 block">Dirección:</span>
                    <strong className="text-blue-300">
                      {photoScanResult.rawAddress || 'No detectada'} ({photoScanResult.neighborhood})
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {unitResult && (
            <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/50 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-black text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" />
                  {unitResult.passed ? 'TEST 100% APROBADO' : 'REVISAR CAMPOS'}
                </span>
                <span className="font-mono text-[11px] text-emerald-300">
                  Latencia: {unitResult.durationMs} ms
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px]">
                <div>
                  <span className="text-slate-400 block">Últimos 4 Dígitos:</span>
                  <strong className="font-mono text-base text-amber-400">
                    #{unitResult.extractedLast4}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Celular WhatsApp:</span>
                  <strong className="font-mono text-emerald-300">
                    {unitResult.extractedPhone}
                  </strong>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400 block">Nombre Extraído:</span>
                  <strong className="text-white">{unitResult.extractedName}</strong>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400 block">Dirección y Nomenclatura Medellín:</span>
                  <strong className="text-blue-300">
                    {unitResult.parsedNomenclature} (Cuadra: {unitResult.blockKey})
                  </strong>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SECCIÓN 2: BENCHMARK DE VELOCIDAD DE CÁMARA Y LECTOR */}
        <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2.5">
          <span className="text-xs font-black text-blue-400 uppercase flex items-center gap-1.5">
            <Barcode className="w-4 h-4" />
            2. Benchmark de Velocidad de Cámara (Sin ensuciar contabilidad)
          </span>

          {!cameraActive ? (
            <button
              type="button"
              onClick={startBenchmarkCamera}
              className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md"
            >
              <Camera className="w-4 h-4" />
              <span>INICIAR BARCODE SPEED TEST CON CÁMARA</span>
            </button>
          ) : (
            <div className="rounded-xl overflow-hidden border-2 border-blue-500 bg-black">
              <div id={benchmarkContainerId} className="w-full min-h-[180px]" />
              <button
                type="button"
                onClick={stopBenchmarkCamera}
                className="w-full py-2 bg-rose-600 text-white font-bold text-xs flex items-center justify-center gap-1.5"
              >
                <CameraOff className="w-4 h-4" />
                <span>Detener Test de Cámara</span>
              </button>
            </div>
          )}

          {cameraError && <p className="text-xs text-rose-400 font-bold">{cameraError}</p>}

          {cameraBenchmark && (
            <div className="p-3 rounded-xl bg-blue-950/60 border border-blue-500/50 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-black text-emerald-400">
                  ✅ Código Leído ({cameraBenchmark.formatName})
                </span>
                <span className="font-mono font-black text-amber-400 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {cameraBenchmark.decodeTimeMs} ms
                </span>
              </div>
              <p className="font-mono text-sm font-black text-white">
                Valor: {cameraBenchmark.decodedText} (Últ. 4: #
                {extractLastFourDigits(cameraBenchmark.decodedText)})
              </p>
            </div>
          )}
        </div>

        {/* SECCIÓN 3: TEST DE ESTRÉS DE BASE DE DATOS Y ENRUTADOR (40 PAQUETES) */}
        <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2.5">
          <span className="text-xs font-black text-emerald-400 uppercase flex items-center gap-1.5">
            <Rocket className="w-4 h-4" />
            3. Test de Estrés IndexedDB + Enrutador Serpiente (40 Paquetes)
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isRunningStress}
              onClick={handleRunStressTest40}
              className="py-3 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-md"
            >
              <Rocket className="w-4 h-4 shrink-0" />
              <span>🚀 Simular Carga de 40 Paquetes</span>
            </button>

            <button
              type="button"
              onClick={handleCleanTestData}
              className="py-3 px-3 rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-500/50 text-rose-200 font-black text-xs flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              <span>🧹 Limpiar Datos de Prueba</span>
            </button>
          </div>

          {stressMetrics && (
            <div className="grid grid-cols-3 gap-2 pt-1 text-center text-xs">
              <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block font-bold">
                  BULK INSERT (40)
                </span>
                <span className="font-mono font-black text-emerald-400">
                  {stressMetrics.insertTimeMs} ms
                </span>
              </div>
              <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block font-bold">
                  RUTA SERPIENTE
                </span>
                <span className="font-mono font-black text-blue-400">
                  {stressMetrics.snakeSortTimeMs} ms
                </span>
              </div>
              <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block font-bold">
                  TIEMPO TOTAL
                </span>
                <span className="font-mono font-black text-amber-400">
                  {stressMetrics.totalTimeMs} ms
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
