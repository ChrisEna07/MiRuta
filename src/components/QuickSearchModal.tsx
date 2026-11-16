import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Search,
  X,
  Navigation,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Phone,
  User,
  ArrowRight
} from 'lucide-react';
import { db, type DeliveryPackage } from '../db/database';
import { openWazeNavigation, formatCOP } from '../utils/mediaAndFeedback';
import { PackageSizeBadge } from './PackageSizeBadge';

interface QuickSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPackage?: (pkg: DeliveryPackage) => void;
  setFocusedPackageId?: (id: string | null) => void;
  setActiveTab?: (tab: 'pilot' | 'route' | 'quincena' | 'settings') => void;
  highContrastSun?: boolean;
}

export const QuickSearchModal: React.FC<QuickSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectPackage,
  setFocusedPackageId,
  setActiveTab,
  highContrastSun = false,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSelectResult = (pkg: DeliveryPackage) => {
    if (setFocusedPackageId) {
      setFocusedPackageId(pkg.trackingNumber);
    }
    if (setActiveTab) {
      setActiveTab('route');
    }
    onClose();
    if (onSelectPackage) {
      onSelectPackage(pkg);
    }
  };

  // Consulta en vivo reactiva a IndexedDB
  const allPackages = useLiveQuery(() => db.packages.toArray(), []) || [];

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 80);
    } else {
      setSearchTerm('');
    }
  }, [isOpen]);

  const filteredResults = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) {
      // Si no ha escrito nada, mostrar los primeros 6 más recientes pendientes
      return allPackages
        .filter((p) => !p.archivedInHistory)
        .slice(0, 6);
    }

    return allPackages.filter((pkg) => {
      const matchLast4 = pkg.lastFourDigits?.toLowerCase().includes(q);
      const matchTracking = pkg.trackingNumber?.toLowerCase().includes(q);
      const matchAddress = pkg.rawAddress?.toLowerCase().includes(q);
      const matchName = pkg.recipientName?.toLowerCase().includes(q);
      const matchPhone = pkg.recipientPhone?.includes(q);

      return matchLast4 || matchTracking || matchAddress || matchName || matchPhone;
    });
  }, [allPackages, searchTerm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-5 pt-8 sm:pt-14 touch-scroll-y">
      <div
        className={`w-full max-w-lg rounded-3xl border shadow-2xl flex flex-col max-h-[85dvh] overflow-hidden transition-all ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-950'
            : 'bg-slate-900 border-slate-700 text-slate-100'
        }`}
      >
        {/* Barra de Búsqueda Superior */}
        <div className="p-3.5 border-b border-slate-800 bg-slate-950/60 flex items-center gap-2.5 shrink-0">
          <div className="relative flex-1">
            <Search className="w-5 h-5 text-amber-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Escribe últimos 4 dígitos (#6672), guía, cliente o dirección..."
              className={`w-full pl-10 pr-9 py-3 rounded-2xl text-sm font-bold border focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all ${
                highContrastSun
                  ? 'bg-slate-100 border-slate-300 text-slate-950'
                  : 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
              }`}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold shrink-0 cursor-pointer"
          >
            Cerrar
          </button>
        </div>

        {/* Header informativo de resultados */}
        <div className="px-4 py-2 bg-slate-950/40 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <span>
            {searchTerm.trim()
              ? `Resultados encontrados: ${filteredResults.length}`
              : 'Paquetes de la ruta de hoy:'}
          </span>
          <span className="font-mono text-[11px] text-amber-400 font-bold">
            Total en base local: {allPackages.length}
          </span>
        </div>

        {/* Lista de Resultados con Scroll Fluido */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 touch-scroll-y">
          {filteredResults.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <Search className="w-10 h-10 text-slate-600 mx-auto" />
              <p className="text-sm font-black text-slate-300">
                No se encontró ninguna guía que coincida con "{searchTerm}"
              </p>
              <p className="text-xs text-slate-500">
                Verifica los 4 dígitos o prueba buscando por el nombre del cliente o la calle.
              </p>
            </div>
          ) : (
            filteredResults.map((pkg) => {
              const isDelivered = pkg.status === 'delivered';
              const isIssue = pkg.status === 'issue';

              return (
                <div
                  key={pkg.id ?? pkg.trackingNumber}
                  onClick={() => handleSelectResult(pkg)}
                  className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                    isDelivered
                      ? 'bg-slate-950/40 border-emerald-950/60 opacity-80'
                      : isIssue
                      ? 'bg-rose-950/20 border-rose-900/40'
                      : 'bg-slate-950/90 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    {/* Columna Izquierda: 4 Dígitos Grandes + Badge Tamaño */}
                    <div className="shrink-0 flex flex-col items-center gap-1">
                      <span className="text-2xl font-black font-mono text-amber-400 leading-none">
                        #{pkg.lastFourDigits}
                      </span>
                      <PackageSizeBadge size={pkg.packageSize} variant="pill" />
                      {pkg.batchNumber && (
                        <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                          T{pkg.batchNumber}
                        </span>
                      )}
                    </div>

                    {/* Columna Central: Datos de Entrega */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs sm:text-sm font-black text-white truncate">
                          {pkg.rawAddress}
                        </span>
                        {isDelivered && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-0.5">
                            <CheckCircle2 className="w-3 h-3" /> Entregado
                          </span>
                        )}
                        {isIssue && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center gap-0.5">
                            <AlertTriangle className="w-3 h-3" /> Novedad
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-300 font-semibold mt-0.5 truncate">
                        👤 {pkg.recipientName || 'Sin destinatario'}
                      </p>

                      <p className="text-[11px] font-mono text-slate-500 mt-0.5 truncate">
                        Guía: {pkg.trackingNumber}
                      </p>

                      {pkg.recipientPhone && (
                        <p className="text-[11px] text-emerald-400/90 font-mono flex items-center gap-1 mt-0.5">
                          <Phone className="w-3 h-3" /> {pkg.recipientPhone}
                        </p>
                      )}
                    </div>

                    {/* Columna Derecha: Acciones Rápidas */}
                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openWazeNavigation(pkg.rawAddress, pkg.coordinates);
                        }}
                        className="py-1 px-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-[11px] flex items-center gap-1 shadow-sm active:scale-95 transition-all cursor-pointer"
                        title="Navegar en Waze"
                      >
                        <Navigation className="w-3.5 h-3.5 fill-slate-950 shrink-0" />
                        <span>Waze</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectResult(pkg);
                        }}
                        className="py-1 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[11px] flex items-center gap-0.5 border border-slate-700 active:scale-95 cursor-pointer"
                      >
                        <span>Ver Ficha</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
