import React, { useState, useMemo } from 'react';
import {
  Zap,
  Compass,
  Navigation,
  Map,
  ArrowUp,
  ArrowDown,
  Crosshair,
  Search,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  RotateCcw,
  Plus,
  Loader2,
  Package,
  Layers,
  Bike,
  ShieldAlert,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { db, type DeliveryPackage, getMaxMotorcycleCapacity } from '../db/database';
import { detectSameBlockClusters } from '../utils/addressParser';
import { openWazeNavigation, buildNavigationLinks } from '../utils/mediaAndFeedback';
import { PackageSizeBadge } from './PackageSizeBadge';
import {
  sortPackagesOfflineSnake,
  solveTSPNearestNeighbor2Opt,
  geocodeMedellinAddress,
  persistRouteOrder,
  getCurrentMotorcycleGPS,
  type SweepDirection,
} from '../utils/routeOptimizer';
import {
  partitionPackagesIntoMotorcycleBatches,
  persistMotorcycleBatches,
  type BatchClusterGroup,
} from '../services/BatchStagingManager';
import { seedMedellinDemoBatch } from '../utils/demoSeeder';
import { useToast, useConfirm } from './ui/FeedbackSystem';

interface RouteOptimizerViewProps {
  packages: DeliveryPackage[];
  highContrastSun: boolean;
  onOpenScanner: () => void;
}

export const RouteOptimizerView: React.FC<RouteOptimizerViewProps> = ({
  packages,
  highContrastSun,
  onOpenScanner,
}) => {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sweepDirection, setSweepDirection] = useState<SweepDirection>('snake');
  const [primaryAxis, setPrimaryAxis] = useState<'CR' | 'CL'>('CR');
  const [optimizingStatus, setOptimizingStatus] = useState<string>('');
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [optimizeReady, setOptimizeReady] = useState<boolean>(false);
  const [selectedBatchFilter, setSelectedBatchFilter] = useState<number | 'all'>('all');

  const maxCapacity = getMaxMotorcycleCapacity();

  const unarchivedPackages = packages.filter((p) => !p.archivedInHistory);

  // Análisis y Partición en Tandas de Carga de Moto
  const stagingAnalysis = useMemo(() => {
    return partitionPackagesIntoMotorcycleBatches(unarchivedPackages, maxCapacity);
  }, [unarchivedPackages, maxCapacity]);

  const orderedPackages = [...unarchivedPackages].sort((a, b) => {
    const aDone = a.status === 'delivered' || a.status === 'issue' ? 1 : 0;
    const bDone = b.status === 'delivered' || b.status === 'issue' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;

    // Si ambos tienen tanda asignada, ordenar por tanda
    const aBatch = a.batchNumber || 1;
    const bBatch = b.batchNumber || 1;
    if (aBatch !== bBatch) return aBatch - bBatch;

    return (a.routeOrder || 0) - (b.routeOrder || 0);
  });

  const sameBlockAlerts = detectSameBlockClusters(unarchivedPackages);
  const issuePackages = unarchivedPackages.filter((p) => p.status === 'issue');

  // Optimización Híbrida con Distribución Automática de Tandas en Moto y GPS real
  const handleAutoBatchOptimize = async () => {
    setIsOptimizing(true);
    setOptimizingStatus('Obteniendo GPS de la moto para iniciar desde el punto más cercano...');
    try {
      const liveGPS = await getCurrentMotorcycleGPS(3000);
      setOptimizingStatus('Agrupando en tandas compactas para moto (< 20 cuadras)...');
      const result = partitionPackagesIntoMotorcycleBatches(unarchivedPackages, maxCapacity, liveGPS);
      await persistMotorcycleBatches(result.batches);

      setOptimizingStatus(
        `✅ ¡${result.totalBatches} tandas organizadas desde tu GPS! Capacidad máx: ${maxCapacity} paqs/tanda.`
      );
      setOptimizeReady(true);
      toast.success(
        `🛵 ${result.totalBatches} Tandas de Moto Calculadas`,
        `Iniciando en tu ubicación real • ${result.isolatedPackages.length} alertas de paquetes aislados.`
      );
      setTimeout(() => setOptimizeReady(false), 2000);
    } catch {
      toast.error('Error calculando las tandas de moto');
    } finally {
      setIsOptimizing(false);
      setTimeout(() => setOptimizingStatus(''), 4500);
    }
  };

  const handleRetryNoveltyPackage = async (pkg: DeliveryPackage) => {
    if (pkg.id === undefined) return;
    const targetBatch = selectedBatchFilter !== 'all' ? selectedBatchFilter : (pkg.batchNumber || 1);
    await db.packages.update(pkg.id, {
      status: 'pending',
      batchNumber: targetBatch,
      deliveredAt: undefined,
      arrivedAtPointAt: undefined,
      issueNote: pkg.issueNote ? `[Reintento] ${pkg.issueNote}` : undefined,
      archivedInHistory: false,
    });
    toast.success(
      `🔄 Paquete #${pkg.lastFourDigits} Reincorporado a la Ruta`,
      `Reasignado a Tanda ${targetBatch} listo para entregar.`
    );
  };

  const handleFinishCurrentBatch = async (batchNum: number) => {
    const accepted = await confirm({
      title: `🏁 ¿Terminar Tanda ${batchNum} y cargar siguiente?`,
      description: `Los paquetes pendientes de la Tanda ${batchNum} se mantendrán y pasarás a cargar en tu moto la Tanda ${batchNum + 1}.`,
      confirmLabel: 'Sí, pasar a siguiente tanda',
      cancelLabel: 'Seguir en esta tanda',
      variant: 'info',
    });
    if (!accepted) return;

    setSelectedBatchFilter(batchNum + 1);
    toast.success(
      `🛵 Tanda ${batchNum + 1} Activada`,
      '¡Listo para cargar el siguiente bloque en la moto!'
    );
  };

  const handleMoveOrder = async (pkg: DeliveryPackage, delta: -1 | 1) => {
    const active = orderedPackages.filter(
      (p) => p.status === 'pending' || p.status === 'in_progress'
    );
    const idx = active.findIndex((p) => p.id === pkg.id);
    if (idx === -1) return;
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= active.length) return;

    const copy = [...active];
    const [moved] = copy.splice(idx, 1);
    copy.splice(targetIdx, 0, moved);

    const completed = orderedPackages.filter(
      (p) => p.status !== 'pending' && p.status !== 'in_progress'
    );
    await persistRouteOrder([...copy, ...completed]);
  };

  const handlePinAsNextStop = async (pkg: DeliveryPackage) => {
    const active = orderedPackages.filter(
      (p) => p.status === 'pending' || p.status === 'in_progress'
    );
    const others = active.filter((p) => p.id !== pkg.id);
    const completed = orderedPackages.filter(
      (p) => p.status !== 'pending' && p.status !== 'in_progress'
    );
    await persistRouteOrder([pkg, ...others, ...completed]);
    toast.info(`🎯 Guía #${pkg.lastFourDigits} fijada como siguiente parada`, pkg.rawAddress);
  };

  const handleReopenPackage = async (pkg: DeliveryPackage) => {
    if (pkg.id === undefined) return;
    await db.packages.update(pkg.id, {
      status: 'pending',
      deliveredAt: undefined,
      issueNote: '',
    });
    toast.info(`🔄 Guía #${pkg.lastFourDigits} devuelta a pendientes`);
  };

  const handleDeletePackage = async (pkg: DeliveryPackage) => {
    if (pkg.id === undefined) return;
    const accepted = await confirm({
      title: `¿Eliminar guía #${pkg.lastFourDigits}?`,
      description: `Se eliminará de tu ruta actual el paquete hacia ${pkg.rawAddress} (${pkg.recipientName}).`,
      confirmLabel: '🗑️ Sí, eliminar paquete',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (accepted) {
      await db.packages.delete(pkg.id);
      toast.info(`🗑️ Guía #${pkg.lastFourDigits} eliminada`);
    }
  };

  const filtered = orderedPackages.filter((p) => {
    if (selectedBatchFilter !== 'all') {
      const bNum = p.batchNumber || 1;
      if (bNum !== selectedBatchFilter) return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.lastFourDigits.toLowerCase().includes(q) ||
      p.trackingNumber.toLowerCase().includes(q) ||
      p.rawAddress.toLowerCase().includes(q) ||
      p.recipientName.toLowerCase().includes(q)
    );
  });

  const nextPendingPkg = filtered.find(
    (p) => p.status === 'pending' || p.status === 'in_progress'
  );

  return (
    <div className="max-w-lg mx-auto px-4 py-2.5 space-y-3.5">
      {/* 1. MÓDULO GESTIÓN DE TANDAS EN MOTO (v8.1 BATCH STAGING) */}
      <div
        className={`rounded-3xl border-2 p-4 shadow-xl space-y-3 ${
          highContrastSun
            ? 'bg-white border-amber-500 text-slate-950'
            : 'bg-slate-900/95 border-amber-500/50 text-slate-50'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-amber-500 text-slate-950 font-black shadow-md shrink-0">
              <Bike className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  🛵 Límite Moto: {maxCapacity} paqs/tanda
                </span>
                <span className="text-[10px] font-bold text-slate-400">
                  {stagingAnalysis.totalBatches} tandas calculadas
                </span>
              </div>
              <h2 className="text-base font-black mt-0.5">
                Escalas para Cargar (Tandas en Moto)
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenScanner}
            className="px-3 py-2 rounded-xl bg-emerald-600 text-white font-black text-xs flex items-center gap-1 shadow-md shrink-0 active:scale-95 transition-transform"
          >
            <Plus className="w-4 h-4" />
            <span>Agregar</span>
          </button>
        </div>

        {/* Botón Principal: ⚡ Optimizar y Particionar en Tandas Geográficas */}
        <button
          type="button"
          disabled={isOptimizing || packages.length === 0}
          onClick={handleAutoBatchOptimize}
          className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xl shadow-amber-500/25 active:scale-[0.99] transition-all cursor-pointer"
        >
          {isOptimizing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin text-slate-950 shrink-0" />
              <span>AGRUPANDO TANDAS POR PROXIMIDAD RADIAL...</span>
            </>
          ) : optimizeReady ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-slate-950 shrink-0" />
              <span>✅ ¡TANDAS Y SERPIENTE OPTIMIZADAS!</span>
            </>
          ) : (
            <>
              <Layers className="w-5 h-5 text-slate-950 shrink-0" />
              <span>⚡ ORGANIZAR TANDAS EN MOTO (CERO DESVÍOS LARGOS)</span>
            </>
          )}
        </button>

        {optimizingStatus && (
          <div className="p-2.5 rounded-xl bg-blue-950/80 border border-blue-500/40 text-blue-200 text-xs font-bold">
            {optimizingStatus}
          </div>
        )}

        {/* Selector de Pestañas de Tandas (Tanda 1, Tanda 2, Ver Todos) */}
        {stagingAnalysis.batches.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              <button
                type="button"
                onClick={() => setSelectedBatchFilter('all')}
                className={`py-1.5 px-3 rounded-xl text-xs font-black whitespace-nowrap transition-all ${
                  selectedBatchFilter === 'all'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Todas ({unarchivedPackages.length})
              </button>

              {stagingAnalysis.batches.map((batch) => (
                <button
                  key={batch.batchNumber}
                  type="button"
                  onClick={() => setSelectedBatchFilter(batch.batchNumber)}
                  className={`py-1.5 px-3 rounded-xl text-xs font-black whitespace-nowrap flex items-center gap-1.5 transition-all ${
                    selectedBatchFilter === batch.batchNumber
                      ? 'bg-amber-500 text-slate-950 shadow-md'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <span>Tanda {batch.batchNumber}</span>
                  <span className="text-[10px] font-mono opacity-80">
                    ({batch.totalPackages} paqs)
                  </span>
                  {batch.largePackagesCount > 0 && (
                    <span className="text-[9px] bg-red-600 text-white px-1 rounded">
                      📦 {batch.largePackagesCount}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Banner Informativo de la Tanda Seleccionada */}
            {selectedBatchFilter !== 'all' && (
              <div className="p-3 rounded-2xl bg-slate-950/90 border border-slate-800 flex items-center justify-between gap-2">
                <div className="text-xs">
                  <p className="font-black text-amber-400">
                    📦 Tanda {selectedBatchFilter} en Moto (
                    {stagingAnalysis.batches.find((b) => b.batchNumber === selectedBatchFilter)?.totalPackages || 0} / {maxCapacity} paquetes cargados)
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Sector: <strong>{stagingAnalysis.batches.find((b) => b.batchNumber === selectedBatchFilter)?.centerNeighborhood}</strong> • Recorrido en serpiente continua sin desvíos.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleFinishCurrentBatch(Number(selectedBatchFilter))}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs shrink-0 active:scale-95"
                >
                  🏁 Siguiente Lote
                </button>
              </div>
            )}
          </div>
        )}

        {/* Alerta de Paquetes Aislados (> 20 cuadras de la ruta) */}
        {stagingAnalysis.isolatedPackages.length > 0 && (
          <div className="p-3 rounded-2xl bg-rose-950/60 border border-rose-500/50 flex items-start gap-2.5">
            <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-black text-rose-300">
                ⚠️ {stagingAnalysis.isolatedPackages.length} Paquete(s) Aislado(s) a más de 20 cuadras
              </p>
              <p className="text-[11px] text-rose-200/80 mt-0.5 leading-snug">
                Detectados fuera del núcleo del sector ({stagingAnalysis.isolatedPackages.map(p => `#${p.lastFourDigits}`).join(', ')}). Se enviaron al final para no quemar tiempo ni gasolina en la mitad de la tanda.
              </p>
            </div>
          </div>
        )}

        {/* Alertas Automáticas de Misma Cuadra / Unidad Residencial */}
        {sameBlockAlerts.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {sameBlockAlerts.map((alert) => (
              <div
                key={alert.blockKey}
                className={`p-2.5 rounded-xl border flex items-start gap-2 text-xs font-bold ${
                  highContrastSun
                    ? 'bg-amber-100 border-amber-500 text-amber-950'
                    : 'bg-amber-950/70 border-amber-500/50 text-amber-200'
                }`}
              >
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  📦 ¡Ojo! Tienes {alert.packages.length} paquetes en esta misma cuadra (
                  {alert.humanLabel}):{' '}
                  <strong className="font-black underline">
                    {alert.packages.map((p) => `#${p.lastFourDigits}`).join(' y ')}
                  </strong>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Buscador Rápido por Últimos 4 Dígitos (#6672) */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar por últimos 4 dígitos (ej. 6672), dirección o cliente..."
          className={`w-full pl-10 pr-4 py-2.5 rounded-2xl text-xs font-bold border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            highContrastSun
              ? 'bg-white border-slate-300 text-slate-950'
              : 'bg-slate-900 border-slate-800 text-white'
          }`}
        />
      </div>

      {/* Atajo Hero Parada Siguiente a Waze (1-Click) */}
      {nextPendingPkg && (
        <div className="p-3.5 rounded-3xl bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-700 text-white shadow-xl border-2 border-sky-300 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-black/30 text-sky-200">
                🎯 SIGUIENTE PARADA
              </span>
              <span className="text-xs font-mono font-black text-amber-300">
                #{nextPendingPkg.lastFourDigits}
              </span>
              <PackageSizeBadge size={nextPendingPkg.packageSize} variant="pill" />
            </div>
            <p className="text-sm font-black truncate mt-1">
              {nextPendingPkg.rawAddress}
            </p>
            <p className="text-xs text-sky-100 truncate">
              {nextPendingPkg.recipientName} • {nextPendingPkg.parsedAddress?.neighborhood || 'Medellín'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => openWazeNavigation(nextPendingPkg.rawAddress, nextPendingPkg.coordinates)}
            className="py-2.5 px-3.5 rounded-2xl bg-white hover:bg-sky-50 text-slate-950 font-black text-xs sm:text-sm flex items-center gap-1.5 shadow-lg active:scale-95 transition-all shrink-0 cursor-pointer"
          >
            <Navigation className="w-4 h-4 fill-sky-600 text-sky-600 shrink-0" />
            <span>🧭 Navegar en Waze</span>
          </button>
        </div>
      )}

      {/* SECCIÓN DESTACADA: PAQUETES CON NOVEDAD / PENDIENTES DE REINTENTO (v9.5) */}
      {issuePackages.length > 0 && (
        <div className="p-3.5 rounded-3xl bg-rose-950/40 border-2 border-rose-500/70 shadow-xl space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-xl bg-rose-500 text-white font-black">
                <AlertTriangle className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-xs sm:text-sm font-black text-rose-200">
                  📦 Paquetes con Novedad / Reintento ({issuePackages.length})
                </h3>
                <p className="text-[10px] text-rose-300/80">
                  Reintenta entregarlos hoy mismo sin volver a escanear
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {issuePackages.map((pkg) => (
              <div
                key={pkg.id}
                className="p-3 rounded-2xl bg-slate-900 border border-rose-500/40 flex items-center justify-between gap-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-black font-mono text-amber-400">
                      #{pkg.lastFourDigits}
                    </span>
                    <span className="text-xs font-bold text-white truncate">
                      {pkg.rawAddress}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 truncate">
                    👤 {pkg.recipientName} • {pkg.parsedAddress?.neighborhood || 'Medellín'}
                  </p>
                  {pkg.issueNote && (
                    <p className="text-[10px] font-semibold text-rose-400">
                      Motivo: {pkg.issueNote}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => handleRetryNoveltyPackage(pkg)}
                  className="py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-md active:scale-95 shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4 shrink-0" />
                  <span>🔄 Reintentar / Reasignar a Ruta</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lista de Paquetes de la Jornada */}
      {filtered.length === 0 ? (
        <div
          className={`rounded-2xl border p-5 text-center space-y-3 ${
            highContrastSun
              ? 'bg-white border-slate-300 text-slate-900'
              : 'bg-slate-900/70 border-slate-800 text-slate-300'
          }`}
        >
          <p className="text-xs font-bold">No hay paquetes en el filtro seleccionado.</p>
          <button
            type="button"
            onClick={() => seedMedellinDemoBatch()}
            className="py-2.5 px-4 rounded-xl bg-slate-800 border border-slate-700 text-blue-400 font-black text-xs"
          >
            📦 Cargar Lote de Prueba Medellín (6 Paquetes iMile)
          </button>
        </div>
      ) : (
        <div className="space-y-2 pb-4">
          {filtered.map((pkg, idx) => {
            const isCompleted = pkg.status === 'delivered' || pkg.status === 'issue';
            return (
              <div
                key={pkg.id ?? pkg.trackingNumber}
                className={`rounded-2xl border p-3 transition-all ${
                  isCompleted
                    ? highContrastSun
                      ? 'bg-slate-100 border-slate-300 opacity-75'
                      : 'bg-slate-900/40 border-slate-800/60 opacity-65'
                    : pkg.isIsolatedOutlier
                    ? 'bg-rose-950/30 border-rose-500/50'
                    : idx === 0
                    ? highContrastSun
                      ? 'bg-blue-50 border-2 border-blue-600'
                      : 'bg-slate-900 border-2 border-blue-500/80 shadow-md'
                    : highContrastSun
                    ? 'bg-white border-slate-300'
                    : 'bg-slate-900/90 border-slate-800'
                }`}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="shrink-0 flex flex-col items-center">
                      <span className="text-[10px] font-black px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                        #{idx + 1}
                      </span>
                      <span className="mt-1 text-2xl font-black font-mono text-amber-400 leading-none">
                        {pkg.lastFourDigits}
                      </span>
                      {pkg.batchNumber && (
                        <span className="mt-1 text-[9px] font-black px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          T{pkg.batchNumber}
                        </span>
                      )}
                      <div className="mt-1.5">
                        <PackageSizeBadge size={pkg.packageSize} variant="pill" />
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-black truncate">{pkg.rawAddress}</span>
                        {pkg.isIsolatedOutlier && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-400/50">
                            ⚠️ Aislado
                          </span>
                        )}
                        {pkg.status === 'delivered' && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center gap-0.5">
                            <CheckCircle2 className="w-3 h-3" /> Entregado
                          </span>
                        )}
                        {pkg.status === 'issue' && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 flex items-center gap-0.5">
                            <AlertTriangle className="w-3 h-3" /> Novedad
                          </span>
                        )}
                      </div>

                      <p className="text-xs font-semibold text-slate-400 truncate mt-0.5">
                        {pkg.recipientName} • Barrio: {pkg.parsedAddress?.neighborhood || 'Medellín'}
                      </p>
                      <p className="text-[11px] font-mono text-slate-500">
                        Guía: {pkg.trackingNumber}
                      </p>
                      {pkg.issueNote && (
                        <p className="text-[11px] font-bold text-rose-400 mt-0.5">
                          Nota: {pkg.issueNote}
                        </p>
                      )}

                      {/* Botón directo de navegación Waze por parada */}
                      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                        {pkg.status === 'issue' && (
                          <button
                            type="button"
                            onClick={() => handleRetryNoveltyPackage(pkg)}
                            className="py-1 px-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-[11px] flex items-center gap-1 shadow-sm active:scale-95 transition-all cursor-pointer"
                            title="Reintentar / Reasignar a Ruta"
                          >
                            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                            <span>🔄 Reintentar en Ruta</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => openWazeNavigation(pkg.rawAddress, pkg.coordinates)}
                          className="py-1 px-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-[11px] flex items-center gap-1 shadow-sm active:scale-95 transition-all cursor-pointer"
                          title="Navegar directo con Waze"
                        >
                          <Navigation className="w-3.5 h-3.5 fill-slate-950 shrink-0" />
                          <span>🧭 Navegar en Waze</span>
                        </button>

                        <a
                          href={buildNavigationLinks(pkg).googleMapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-1 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[11px] flex items-center gap-1 border border-slate-700 active:scale-95"
                          title="Abrir en Google Maps"
                        >
                          <Map className="w-3 h-3 text-blue-400 shrink-0" />
                          <span>Maps</span>
                        </a>
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-1">
                    {!isCompleted ? (
                      <>
                        {idx > 0 && (
                          <button
                            type="button"
                            onClick={() => handlePinAsNextStop(pkg)}
                            title="Fijar como Siguiente Parada"
                            className="p-2 rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-400 hover:bg-blue-600 hover:text-white"
                          >
                            <Crosshair className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleMoveOrder(pkg, -1)}
                          title="Subir en la ruta"
                          className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveOrder(pkg, 1)}
                          title="Bajar en la ruta"
                          className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleReopenPackage(pkg)}
                        title="Devolver a pendiente"
                        className="p-2 rounded-xl bg-slate-800 text-amber-400"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDeletePackage(pkg)}
                      title="Eliminar paquete"
                      className="p-2 rounded-xl bg-slate-800/60 text-rose-400 hover:bg-rose-600 hover:text-white"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
