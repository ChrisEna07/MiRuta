import React, { useState, useMemo, useEffect } from 'react';
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
  Copy,
  X
} from 'lucide-react';
import { db, type DeliveryPackage, getMaxMotorcycleCapacity } from '../db/database';
import { detectSameBlockClusters } from '../utils/addressParser';
import { buildNavigationLinks, playCashRegisterSuccess } from '../utils/mediaAndFeedback';
import { PackageSizeBadge } from './PackageSizeBadge';
import {
  sortPackagesOfflineSnake,
  solveTSPNearestNeighbor2Opt,
  geocodeMedellinAddress,
  persistRouteOrder,
  getCurrentMotorcycleGPS,
  optimizeRouteWithStrategy,
  type SweepDirection,
  type RoutingStrategy,
} from '../utils/routeOptimizer';
import {
  partitionPackagesIntoMotorcycleBatches,
  persistMotorcycleBatches,
  type BatchClusterGroup,
} from '../services/BatchStagingManager';
import { seedMedellinDemoBatch } from '../utils/demoSeeder';
import { useToast, useConfirm } from './ui/FeedbackSystem';
import { PackageDetailsModal } from './PackageDetailsModal';

interface RouteOptimizerViewProps {
  packages: DeliveryPackage[];
  highContrastSun: boolean;
  onOpenScanner: () => void;
  focusedPackageId?: string | null;
  setFocusedPackageId?: (id: string | null) => void;
}

export const RouteOptimizerView: React.FC<RouteOptimizerViewProps> = ({
  packages,
  highContrastSun,
  onOpenScanner,
  focusedPackageId,
  setFocusedPackageId,
}) => {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [selectedPackage, setSelectedPackage] = useState<DeliveryPackage | null>(null);

  // Auto-apertura de tarjeta desde búsqueda (v10.6)
  useEffect(() => {
    if (focusedPackageId) {
      const pkgToFocus = packages.find((p) => p.trackingNumber === focusedPackageId);
      if (pkgToFocus) {
        setSelectedPackage(pkgToFocus);
        if (setFocusedPackageId) {
          setFocusedPackageId(null);
        }
      }
    }
  }, [focusedPackageId, packages, setFocusedPackageId]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sweepDirection, setSweepDirection] = useState<SweepDirection>('snake');
  const [primaryAxis, setPrimaryAxis] = useState<'CR' | 'CL'>('CR');
  const [optimizingStatus, setOptimizingStatus] = useState<string>('');
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [optimizeReady, setOptimizeReady] = useState<boolean>(false);
  const [selectedBatchFilter, setSelectedBatchFilter] = useState<number | 'all'>('all');

  // Modal de Configuración de Ruta Pre-Condicionada v10.0
  const [showRouteConfigModal, setShowRouteConfigModal] = useState<boolean>(false);
  const [gpsStatus, setGpsStatus] = useState<'locating' | 'ready'>('locating');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

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

  // Abrir Modal de Configuración y Forzar Lectura GPS en Vivo de la Moto
  const handleOpenRouteConfig = () => {
    setShowRouteConfigModal(true);
    setGpsStatus('locating');
    setUserCoords(null);

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            lat: Number(pos.coords.latitude.toFixed(6)),
            lng: Number(pos.coords.longitude.toFixed(6))
          };
          setUserCoords(coords);
          setGpsStatus('ready');
        },
        async () => {
          const fallback = await getCurrentMotorcycleGPS(3000);
          setUserCoords(fallback);
          setGpsStatus('ready');
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 }
      );
    } else {
      getCurrentMotorcycleGPS(3000).then((fallback) => {
        setUserCoords(fallback);
        setGpsStatus('ready');
      });
    }
  };

  // Aplicar Estrategia Seleccionada con NODO 0 = Coordenadas GPS Actuales
  const handleSelectStrategy = async (strategy: RoutingStrategy) => {
    const coords = userCoords || (await getCurrentMotorcycleGPS(3000));
    setShowRouteConfigModal(false);
    setIsOptimizing(true);
    setOptimizingStatus('Calculando ruta con NODO 0 en tu ubicación...');

    try {
      // 1. Reordenar con NODO 0 = coords y estrategia elegida
      const ordered = optimizeRouteWithStrategy(unarchivedPackages, coords, strategy);
      await persistRouteOrder(ordered);

      // 2. Particionar tandas con NODO 0 = coords
      const result = partitionPackagesIntoMotorcycleBatches(ordered, maxCapacity, coords);
      await persistMotorcycleBatches(result.batches);

      playCashRegisterSuccess();
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([60, 40, 60]);
      }

      const strategyNames: Record<RoutingStrategy, string> = {
        nearest_first: 'De más cerca a más lejos 🚀',
        furthest_first: 'De más lejos a más cerca 🔄',
        snake_neighborhood: 'Serpiente / Vecindario 🐍'
      };

      toast.success(
        `✅ Ruta Optimizada: ${strategyNames[strategy]}`,
        `NODO 0 fijado en tu GPS actual (${coords.lat}, ${coords.lng}).`
      );
      setOptimizeReady(true);
      setTimeout(() => setOptimizeReady(false), 2500);
    } catch {
      toast.error('Error calculando la ruta con la estrategia seleccionada');
    } finally {
      setIsOptimizing(false);
      setOptimizingStatus('');
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

        {/* Botón Principal: ⚡ Optimizar y Particionar en Tandas Geográficas con Estrategia GPS */}
        <button
          type="button"
          disabled={isOptimizing || packages.length === 0}
          onClick={handleOpenRouteConfig}
          className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xl shadow-amber-500/25 active:scale-[0.99] transition-all cursor-pointer"
        >
          {isOptimizing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin text-slate-950 shrink-0" />
              <span>CALCULANDO RUTA Y TANDAS DESDE TU GPS...</span>
            </>
          ) : optimizeReady ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-slate-950 shrink-0" />
              <span>✅ ¡RUTA OPTIMIZADA CON ÉXITO!</span>
            </>
          ) : (
            <>
              <Compass className="w-5 h-5 text-slate-950 shrink-0" />
              <span>⚡ OPTIMIZAR / ORDENAR PEDIDOS (ESTRATEGIA GPS)</span>
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
            onClick={() => handleCopyAddress(nextPendingPkg.rawAddress)}
            className="py-2.5 px-3.5 rounded-2xl bg-white hover:bg-sky-50 text-slate-950 font-black text-xs sm:text-sm flex items-center gap-1.5 shadow-lg active:scale-95 transition-all shrink-0 cursor-pointer"
          >
            <Copy className="w-4 h-4 text-blue-600 shrink-0" />
            <span>📋 Copiar Dirección</span>
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
                          onClick={() => handleCopyAddress(pkg.rawAddress)}
                          className="py-1 px-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-[11px] flex items-center gap-1 shadow-sm active:scale-95 transition-all cursor-pointer"
                          title="Copiar dirección al portapapeles"
                        >
                          <Copy className="w-3.5 h-3.5 shrink-0" />
                          <span>📋 Copiar Dirección</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setSelectedPackage(pkg)}
                          className="py-1 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[11px] flex items-center gap-1 border border-slate-700 active:scale-95 cursor-pointer"
                          title="Ver ficha completa y WhatsApp"
                        >
                          <span>Ver Ficha</span>
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

      {/* MODAL DE CONFIGURACIÓN DE RUTA PRE-CONDICIONADA v10.0 */}
      {showRouteConfigModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4 touch-scroll-y">
          <div
            className={`w-full max-w-md rounded-3xl border p-5 shadow-2xl space-y-4 max-h-[90dvh] touch-scroll-y my-auto ${
              highContrastSun
                ? 'bg-white border-slate-300 text-slate-950'
                : 'bg-slate-900 border-slate-800 text-slate-100'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-2xl bg-amber-500 text-slate-950 font-black">
                  <Compass className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-amber-400">
                    Configuración de Ruta
                  </h3>
                  <p className="text-xs text-slate-400">
                    NODO 0 anclado en tu GPS actual
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRouteConfigModal(false)}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Estado GPS en vivo */}
            <div
              className={`p-3 rounded-2xl border-2 flex items-center gap-3 ${
                gpsStatus === 'locating'
                  ? 'bg-blue-950/60 border-blue-500 text-blue-200 animate-pulse'
                  : 'bg-emerald-950/60 border-emerald-500 text-emerald-200'
              }`}
            >
              {gpsStatus === 'locating' ? (
                <>
                  <Loader2 className="w-5 h-5 text-blue-400 animate-spin shrink-0" />
                  <div className="text-xs font-bold">
                    <p className="font-black text-blue-300">
                      📍 Obteniendo tu ubicación actual por GPS...
                    </p>
                    <p className="text-[11px] text-blue-200/80 mt-0.5">
                      Fijando el punto 0 exacto donde estás parado con la moto
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div className="text-xs font-bold">
                    <p className="font-black text-emerald-300">
                      ✅ Ubicación GPS lista como NODO 0
                    </p>
                    <p className="text-[11px] font-mono text-emerald-200/80 mt-0.5">
                      Lat: {userCoords?.lat.toFixed(5)} • Lng: {userCoords?.lng.toFixed(5)}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Opciones de Estrategia */}
            <div className="space-y-2.5">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wide block">
                Selecciona tu Estrategia de Ruteo:
              </span>

              {/* 1. De más cerca a más lejos */}
              <button
                type="button"
                disabled={gpsStatus === 'locating'}
                onClick={() => handleSelectStrategy('nearest_first')}
                className="w-full p-3.5 rounded-2xl bg-slate-850 hover:bg-slate-800 border-2 border-slate-700 hover:border-emerald-500 text-left transition-all active:scale-[0.98] disabled:opacity-50 flex items-start gap-3 cursor-pointer group"
              >
                <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-xl shrink-0 group-hover:scale-105 transition-transform">
                  🚀
                </div>
                <div>
                  <h4 className="text-sm font-black text-white group-hover:text-emerald-300">
                    De más cerca a más lejos
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5 leading-snug">
                    Prioriza vaciar carga rápido cerca de tu posición inicial actual.
                  </p>
                </div>
              </button>

              {/* 2. De más lejos a más cerca */}
              <button
                type="button"
                disabled={gpsStatus === 'locating'}
                onClick={() => handleSelectStrategy('furthest_first')}
                className="w-full p-3.5 rounded-2xl bg-slate-850 hover:bg-slate-800 border-2 border-slate-700 hover:border-blue-500 text-left transition-all active:scale-[0.98] disabled:opacity-50 flex items-start gap-3 cursor-pointer group"
              >
                <div className="p-2.5 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/40 text-xl shrink-0 group-hover:scale-105 transition-transform">
                  🔄
                </div>
                <div>
                  <h4 className="text-sm font-black text-white group-hover:text-blue-300">
                    De más lejos a más cerca
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5 leading-snug">
                    Empieza por el punto más distante y viene regresando hacia casa.
                  </p>
                </div>
              </button>

              {/* 3. Serpiente / Vecindario */}
              <button
                type="button"
                disabled={gpsStatus === 'locating'}
                onClick={() => handleSelectStrategy('snake_neighborhood')}
                className="w-full p-3.5 rounded-2xl bg-slate-850 hover:bg-slate-800 border-2 border-slate-700 hover:border-amber-500 text-left transition-all active:scale-[0.98] disabled:opacity-50 flex items-start gap-3 cursor-pointer group"
              >
                <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 text-xl shrink-0 group-hover:scale-105 transition-transform">
                  🐍
                </div>
                <div>
                  <h4 className="text-sm font-black text-white group-hover:text-amber-300">
                    Serpiente / Vecindario
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5 leading-snug">
                    Agrupación estricta por cuadras, sin importar distancia total, ideal para tandas muy densas.
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Ficha y Detalles del Paquete v10.6 */}
      <PackageDetailsModal
        isOpen={Boolean(selectedPackage)}
        packageData={selectedPackage}
        onClose={() => setSelectedPackage(null)}
        onPinAsNextStop={handlePinAsNextStop}
        onRetryNovelty={handleRetryNoveltyPackage}
        highContrastSun={highContrastSun}
      />
    </div>
  );
};
