import React from 'react';
import {
  ChevronRight,
  Package,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  ShieldAlert,
  Search,
} from 'lucide-react';
import { type DeliveryPackage, getDefaultPackageRate } from '../db/database';
import { formatCOP } from '../utils/mediaAndFeedback';

interface IMileTodayTasksCardProps {
  packages: DeliveryPackage[];
  highContrastSun: boolean;
  onOpenScanner: () => void;
  onOpenIssueScanner?: () => void;
  onOpenSearch?: () => void;
  onSelectFilter?: (filter: 'all' | 'pending' | 'delivered' | 'issue') => void;
}

export const IMileTodayTasksCard: React.FC<IMileTodayTasksCardProps> = ({
  packages,
  highContrastSun,
  onOpenScanner,
  onOpenIssueScanner,
  onOpenSearch,
  onSelectFilter,
}) => {
  const defaultRate = getDefaultPackageRate();

  const totalPackages = packages.length;
  const deliveredList = packages.filter((p) => p.status === 'delivered');
  const deliveredCount = deliveredList.length;
  const issueList = packages.filter((p) => p.status === 'issue');
  const issueCount = issueList.length;
  const pendingCount = packages.filter(
    (p) => !p.archivedInHistory && (p.status === 'pending' || p.status === 'in_progress')
  ).length;

  const completionPercent =
    totalPackages > 0 ? Math.round((deliveredCount / totalPackages) * 100) : 0;

  const totalEarned = deliveredList.reduce((acc, p) => acc + (p.rate || defaultRate), 0);

  return (
    <div className="max-w-lg mx-auto px-4 pt-2.5 pb-1 space-y-3">
      {/* 1. Tarjeta Superior Oscura Característica de iMile Oficial */}
      <div
        className={`rounded-3xl border p-5 shadow-2xl relative overflow-hidden transition-all ${
          highContrastSun
            ? 'bg-slate-900 border-slate-700 text-white'
            : 'bg-slate-900/95 border-slate-800 text-white'
        }`}
      >
        {/* Glow sutil de fondo */}
        <div className="absolute -top-16 -right-16 w-44 h-44 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />

        {/* Header de la Tarjeta: Tareas de Hoy + Contador total */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <h2 className="text-xl sm:text-2xl font-black tracking-tight">
                Tareas de Hoy
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 leading-snug">
              {pendingCount > 0
                ? 'Tareas listas. ¡Empieza las entregas AHORA!'
                : totalPackages > 0
                ? '¡Todas las entregas del día completadas!'
                : 'Sin tareas asignadas. Escanea paquetes para iniciar.'}
            </p>
          </div>

          {/* Badge con total de paquetes estilo iMile (ej: 41 ▶) */}
          <button
            type="button"
            onClick={() => onSelectFilter?.('all')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white shadow-lg active:scale-95 transition-all shrink-0 cursor-pointer"
          >
            <span className="text-xl sm:text-2xl font-black font-mono text-emerald-400">
              {totalPackages}
            </span>
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Barra de Progreso Quincenal / Diaria con porcentaje exacto */}
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-slate-400 flex items-center gap-1.5">
              <span>Progreso de Entrega</span>
              {deliveredCount > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  +{formatCOP(totalEarned)}
                </span>
              )}
            </span>
            <span className="text-emerald-400 font-mono font-black text-sm">
              {completionPercent}%
            </span>
          </div>

          <div className="w-full h-2.5 rounded-full bg-slate-800/90 overflow-hidden p-0.5 border border-slate-700/60">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 via-teal-400 to-emerald-400 transition-all duration-500 shadow-sm"
              style={{ width: `${Math.min(100, Math.max(0, completionPercent))}%` }}
            />
          </div>
        </div>

        {/* 2. Tarjetas de Estado Rápidas (3 Columnas iMile: Escaneo OFD, Completado, Novedad) */}
        <div className="mt-5 grid grid-cols-3 gap-2">
          {/* OFD / Pendientes */}
          <button
            type="button"
            onClick={() => onSelectFilter?.('pending')}
            className="p-3 rounded-2xl bg-slate-800/70 hover:bg-slate-800 border border-slate-700/80 flex flex-col items-center justify-center text-center transition-all active:scale-95 group cursor-pointer"
          >
            <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400 mb-1.5 group-hover:scale-105 transition-transform">
              <Package className="w-5 h-5" />
            </div>
            <span className="text-xl font-black font-mono text-white leading-tight">
              {pendingCount}
            </span>
            <span className="text-[10px] font-bold text-slate-400 mt-0.5 leading-tight">
              Escaneo OFD
            </span>
          </button>

          {/* Completado / Entregados */}
          <button
            type="button"
            onClick={() => onSelectFilter?.('delivered')}
            className="p-3 rounded-2xl bg-slate-800/70 hover:bg-slate-800 border border-slate-700/80 flex flex-col items-center justify-center text-center transition-all active:scale-95 group cursor-pointer"
          >
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 mb-1.5 group-hover:scale-105 transition-transform">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <span className="text-xl font-black font-mono text-emerald-400 leading-tight">
              {deliveredCount}
            </span>
            <span className="text-[10px] font-bold text-slate-400 mt-0.5 leading-tight">
              Completado
            </span>
          </button>

          {/* Problema Reportado / Novedad */}
          <button
            type="button"
            onClick={() => onSelectFilter?.('issue')}
            className="p-3 rounded-2xl bg-slate-800/70 hover:bg-slate-800 border border-slate-700/80 flex flex-col items-center justify-center text-center transition-all active:scale-95 group cursor-pointer"
          >
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 mb-1.5 group-hover:scale-105 transition-transform">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <span className="text-xl font-black font-mono text-amber-400 leading-tight">
              {issueCount}
            </span>
            <span className="text-[10px] font-bold text-slate-400 mt-0.5 leading-tight">
              Novedad
            </span>
          </button>
        </div>
      </div>

      {/* 3. Sección de Operaciones Rápidas iMile Real (Botones anchos) */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={onOpenScanner}
          className="w-full py-4 px-4 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-sm flex items-center justify-between shadow-xl shadow-blue-600/25 border border-blue-400/30 active:scale-[0.98] transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-white/15 text-white">
              <QrCode className="w-5 h-5" />
            </div>
            <div className="text-left">
              <p className="leading-tight">Escaneo entrega</p>
              <p className="text-[10px] text-blue-200 font-medium">
                Escaneo de Respaldo / Captura de Etiqueta
              </p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-blue-200" />
        </button>

        <button
          type="button"
          onClick={() => {
            if (onOpenIssueScanner) {
              onOpenIssueScanner();
            } else {
              onOpenScanner();
            }
          }}
          className="w-full py-3.5 px-4 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-200 font-bold text-sm flex items-center justify-between shadow-md active:scale-[0.98] transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div className="text-left">
              <p className="leading-tight">Reportar un Problema</p>
              <p className="text-[10px] text-slate-400 font-medium">
                Escaneando novedad o devuelto
              </p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-500" />
        </button>
      </div>

      {/* 4. Barra Rápida de Búsqueda de Entrega Flotante Accesible */}
      {onOpenSearch && (
        <div className="pt-0.5">
          <button
            type="button"
            onClick={onOpenSearch}
            className="w-full py-2.5 px-3.5 rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 text-slate-400 text-xs font-bold flex items-center justify-between shadow-sm active:scale-95 transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-slate-400" />
              <span>🔍 Búsqueda de Entrega (Últimos 4 dígitos o dirección)...</span>
            </div>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-900 text-slate-400 border border-slate-700">
              Buscar
            </span>
          </button>
        </div>
      )}
    </div>
  );
};
