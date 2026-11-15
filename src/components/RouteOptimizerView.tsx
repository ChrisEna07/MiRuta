import React, { useState } from 'react';
import {
  Zap,
  Compass,
  ArrowUp,
  ArrowDown,
  Crosshair,
  Search,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  RotateCcw,
  Plus
} from 'lucide-react';
import { db, type DeliveryPackage } from '../db/database';
import { detectSameBlockClusters } from '../utils/addressParser';
import {
  sortPackagesOfflineSnake,
  solveTSPNearestNeighbor2Opt,
  geocodeMedellinAddress,
  persistRouteOrder,
  type SweepDirection
} from '../utils/routeOptimizer';
import { seedMedellinDemoBatch } from '../utils/demoSeeder';

interface RouteOptimizerViewProps {
  packages: DeliveryPackage[];
  highContrastSun: boolean;
  onOpenScanner: () => void;
}

export const RouteOptimizerView: React.FC<RouteOptimizerViewProps> = ({
  packages,
  highContrastSun,
  onOpenScanner
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sweepDirection, setSweepDirection] = useState<SweepDirection>('snake');
  const [primaryAxis, setPrimaryAxis] = useState<'CR' | 'CL'>('CR');
  const [optimizingStatus, setOptimizingStatus] = useState<string>('');
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);

  const unarchivedPackages = packages.filter((p) => !p.archivedInHistory);

  const orderedPackages = [...unarchivedPackages].sort((a, b) => {
    const aDone = a.status === 'delivered' || a.status === 'issue' ? 1 : 0;
    const bDone = b.status === 'delivered' || b.status === 'issue' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return (a.routeOrder || 0) - (b.routeOrder || 0);
  });

  const sameBlockAlerts = detectSameBlockClusters(unarchivedPackages);

  const handleOfflineOptimize = async () => {
    setIsOptimizing(true);
    setOptimizingStatus('Ordenando por Nomenclatura Medellín (Modo Serpiente Offline)...');
    try {
      const sorted = sortPackagesOfflineSnake(packages, sweepDirection, primaryAxis);
      await persistRouteOrder(sorted);
      setOptimizingStatus('✅ ¡Ruta optimizada por nomenclatura Calle/Carrera y guardada en IndexedDB!');
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([50, 30, 70]);
      }
    } finally {
      setIsOptimizing(false);
      setTimeout(() => setOptimizingStatus(''), 4000);
    }
  };

  const handleSmartHybridOptimize = async () => {
    setIsOptimizing(true);
    setOptimizingStatus('Obteniendo ubicación GPS y calculando ruta más corta (TSP + 2-opt)...');

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await handleOfflineOptimize();
        return;
      }

      const userCoords = await new Promise<{ lat: number; lng: number }>((resolve) => {
        if (!navigator.geolocation) {
          resolve({ lat: 6.2088, lng: -75.5678 });
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve({ lat: 6.2088, lng: -75.5678 }),
          { enableHighAccuracy: true, timeout: 4500 }
        );
      });

      const updatedPackages: DeliveryPackage[] = [];
      for (const pkg of packages) {
        if (pkg.status === 'pending' || pkg.status === 'in_progress') {
          const coords = await geocodeMedellinAddress(pkg);
          updatedPackages.push({ ...pkg, coordinates: coords });
        } else {
          updatedPackages.push(pkg);
        }
      }

      const tspOrdered = solveTSPNearestNeighbor2Opt(updatedPackages, userCoords);
      await persistRouteOrder(tspOrdered);

      setOptimizingStatus(
        '✅ ¡Secuencia GPS + TSP 2-opt fijada en IndexedDB! Lista para usar incluso sin señal.'
      );
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([60, 40, 100]);
      }
    } catch {
      await handleOfflineOptimize();
    } finally {
      setIsOptimizing(false);
      setTimeout(() => setOptimizingStatus(''), 4500);
    }
  };

  const handleMoveOrder = async (pkg: DeliveryPackage, delta: -1 | 1) => {
    const active = orderedPackages.filter((p) => p.status === 'pending' || p.status === 'in_progress');
    const idx = active.findIndex((p) => p.id === pkg.id);
    if (idx === -1) return;
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= active.length) return;

    const copy = [...active];
    const [moved] = copy.splice(idx, 1);
    copy.splice(targetIdx, 0, moved);

    const completed = orderedPackages.filter((p) => p.status !== 'pending' && p.status !== 'in_progress');
    await persistRouteOrder([...copy, ...completed]);
  };

  const handlePinAsNextStop = async (pkg: DeliveryPackage) => {
    const active = orderedPackages.filter((p) => p.status === 'pending' || p.status === 'in_progress');
    const others = active.filter((p) => p.id !== pkg.id);
    const completed = orderedPackages.filter((p) => p.status !== 'pending' && p.status !== 'in_progress');
    await persistRouteOrder([pkg, ...others, ...completed]);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(50);
    }
  };

  const handleReopenPackage = async (pkg: DeliveryPackage) => {
    if (pkg.id === undefined) return;
    await db.packages.update(pkg.id, {
      status: 'pending',
      deliveredAt: undefined,
      issueNote: ''
    });
  };

  const handleDeletePackage = async (pkg: DeliveryPackage) => {
    if (pkg.id === undefined) return;
    if (window.confirm(`¿Eliminar guía #${pkg.lastFourDigits} (${pkg.rawAddress})?`)) {
      await db.packages.delete(pkg.id);
    }
  };

  const filtered = orderedPackages.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.lastFourDigits.toLowerCase().includes(q) ||
      p.trackingNumber.toLowerCase().includes(q) ||
      p.rawAddress.toLowerCase().includes(q) ||
      p.recipientName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="max-w-lg mx-auto px-4 py-2.5 space-y-3">
      {/* Panel Motor de Enrutamiento Híbrido */}
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
              <Compass className="w-5 h-5 text-blue-400" />
              <span>Enrutador Inteligente MiRuta</span>
            </h2>
            <p className="text-xs text-slate-400">
              Ordena por nomenclatura Medellín (Serpiente Offline) o GPS TSP Online
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenScanner}
            className="px-3 py-2 rounded-xl bg-emerald-600 text-white font-black text-xs flex items-center gap-1 shadow-md shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Agregar</span>
          </button>
        </div>

        {/* Botón Principal: ⚡ Optimizar Orden de Entrega */}
        <button
          type="button"
          disabled={isOptimizing || packages.length === 0}
          onClick={handleSmartHybridOptimize}
          className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xl shadow-blue-600/30 active:scale-[0.99] transition-transform"
        >
          <Zap className="w-5 h-5 text-amber-300 fill-amber-300 shrink-0" />
          <span>⚡ OPTIMIZAR ORDEN DE ENTREGA (HÍBRIDO GPS / NOMENCLATURA)</span>
        </button>

        {/* Controles Nivel 1: Barrido Serpiente Offline por Carrera/Calle */}
        <div className="grid grid-cols-3 gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => {
              setPrimaryAxis('CR');
              setSweepDirection('snake');
              handleOfflineOptimize();
            }}
            className="py-2 px-2 rounded-xl border border-slate-700 bg-slate-800/80 text-slate-200 text-[11px] font-extrabold hover:bg-slate-800 active:scale-95"
          >
            🐍 Serpiente x Carrera
          </button>
          <button
            type="button"
            onClick={() => {
              setPrimaryAxis('CL');
              setSweepDirection('snake');
              handleOfflineOptimize();
            }}
            className="py-2 px-2 rounded-xl border border-slate-700 bg-slate-800/80 text-slate-200 text-[11px] font-extrabold hover:bg-slate-800 active:scale-95"
          >
            🐍 Serpiente x Calle
          </button>
          <button
            type="button"
            onClick={() => {
              const nextDir = sweepDirection === 'asc' ? 'desc' : 'asc';
              setSweepDirection(nextDir);
              handleOfflineOptimize();
            }}
            className="py-2 px-2 rounded-xl border border-slate-700 bg-slate-800/80 text-slate-200 text-[11px] font-extrabold hover:bg-slate-800 active:scale-95"
          >
            ↕️ {sweepDirection === 'desc' ? 'Descendente' : 'Ascendente'}
          </button>
        </div>

        {optimizingStatus && (
          <div className="p-2.5 rounded-xl bg-blue-950/80 border border-blue-500/40 text-blue-200 text-xs font-bold">
            {optimizingStatus}
          </div>
        )}

        {/* Alertas Automáticas de Misma Cuadra / Unidad Residencial */}
        {sameBlockAlerts.length > 0 && (
          <div className="space-y-1.5">
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

      {/* Lista de Paquetes de la Jornada */}
      {filtered.length === 0 ? (
        <div
          className={`rounded-2xl border p-5 text-center space-y-3 ${
            highContrastSun
              ? 'bg-white border-slate-300 text-slate-900'
              : 'bg-slate-900/70 border-slate-800 text-slate-300'
          }`}
        >
          <p className="text-xs font-bold">No hay paquetes en la lista actual.</p>
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
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-black truncate">{pkg.rawAddress}</span>
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
                        {pkg.recipientName} • Cuadra: {pkg.parsedAddress?.blockKey}
                      </p>
                      <p className="text-[11px] font-mono text-slate-500">
                        Guía: {pkg.trackingNumber}
                      </p>
                      {pkg.issueNote && (
                        <p className="text-[11px] font-bold text-rose-400 mt-0.5">
                          Nota: {pkg.issueNote}
                        </p>
                      )}
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
