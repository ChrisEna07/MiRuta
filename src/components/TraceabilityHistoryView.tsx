import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  MapPin,
  PhoneCall,
  MessageCircle,
  Share2,
  Camera,
  ZoomIn,
  X,
  FileCheck2,
  Calendar,
  Save,
  ExternalLink,
  ShieldCheck,
  RotateCcw
} from 'lucide-react';
import { db, type DeliveryPackage, getTodayShiftId } from '../db/database';
import { compressProofPhotoToBase64, formatCOP } from '../utils/mediaAndFeedback';
import { useToast } from './ui/FeedbackSystem';

interface TraceabilityHistoryViewProps {
  highContrastSun: boolean;
}

type DateFilterMode = 'all' | 'today' | 'yesterday' | 'this_quincena' | 'last_month' | 'custom';
type StatusFilterMode = 'all' | 'delivered' | 'issue' | 'pending';

export const TraceabilityHistoryView: React.FC<TraceabilityHistoryViewProps> = ({
  highContrastSun
}) => {
  const toast = useToast();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<DateFilterMode>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilterMode>('all');
  const [customStart, setCustomStart] = useState<string>(getTodayShiftId());
  const [customEnd, setCustomEnd] = useState<string>(getTodayShiftId());

  // Estado del Modal de Expediente / Detalle Probatorio
  const [selectedPkgId, setSelectedPkgId] = useState<number | null>(null);
  const [auditNoteInput, setAuditNoteInput] = useState<string>('');
  const [zoomPhotoOpen, setZoomPhotoOpen] = useState<boolean>(false);
  const [noteSavedBanner, setNoteSavedBanner] = useState<string>('');

  const allPackages = useLiveQuery(() => db.packages.toArray(), []) || [];

  const selectedPkg = useMemo(() => {
    if (selectedPkgId === null) return null;
    return allPackages.find((p) => p.id === selectedPkgId) || null;
  }, [allPackages, selectedPkgId]);

  const handleOpenAuditModal = (pkg: DeliveryPackage) => {
    if (pkg.id === undefined) return;
    setSelectedPkgId(pkg.id);
    setAuditNoteInput(pkg.auditNote || pkg.issueNote || '');
    setNoteSavedBanner('');
  };

  const handleRetryIssuePackage = async (pkg: DeliveryPackage) => {
    if (pkg.id === undefined) return;
    await db.packages.update(pkg.id, {
      status: 'pending',
      issueNote: pkg.issueNote ? `[Reintento] ${pkg.issueNote}` : undefined,
      archivedInHistory: false,
      arrivedAtPointAt: undefined
    });
    setSelectedPkgId(null);
    toast.success(
      `🔄 Guía #${pkg.lastFourDigits} devuelta a la ruta`,
      'Ya está disponible como pendiente en la pestaña de Ruta y Piloto.'
    );
  };

  // Calcular rango de fechas para el filtro rápido
  const dateRangeBounds = useMemo(() => {
    const todayStr = getTodayShiftId();
    const now = new Date();

    if (dateFilter === 'today') {
      return { start: todayStr, end: todayStr };
    }
    if (dateFilter === 'yesterday') {
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const yStr = getTodayShiftId(y);
      return { start: yStr, end: yStr };
    }
    if (dateFilter === 'this_quincena') {
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      if (now.getDate() <= 15) {
        return { start: `${ym}-01`, end: `${ym}-15` };
      }
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      return { start: `${ym}-16`, end: `${ym}-${String(lastDay).padStart(2, '0')}` };
    }
    if (dateFilter === 'last_month') {
      const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevYm = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
      const lastDayPrev = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 0).getDate();
      return { start: `${prevYm}-01`, end: `${prevYm}-${String(lastDayPrev).padStart(2, '0')}` };
    }
    if (dateFilter === 'custom') {
      return { start: customStart, end: customEnd };
    }
    return null;
  }, [dateFilter, customStart, customEnd]);

  // Filtrado multicriterio instantáneo (< 50ms en memoria desde IndexedDB)
  const filteredPackages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return [...allPackages]
      .filter((pkg) => {
        // Filtro por Estado
        if (statusFilter === 'delivered' && pkg.status !== 'delivered') return false;
        if (statusFilter === 'issue' && pkg.status !== 'issue') return false;
        if (
          statusFilter === 'pending' &&
          pkg.status !== 'pending' &&
          pkg.status !== 'in_progress'
        ) {
          return false;
        }

        // Filtro por Fecha
        if (dateRangeBounds) {
          const pkgDate = pkg.deliveredAt
            ? new Date(pkg.deliveredAt).toISOString().slice(0, 10)
            : pkg.shiftId || new Date(pkg.scannedAt).toISOString().slice(0, 10);
          if (pkgDate < dateRangeBounds.start || pkgDate > dateRangeBounds.end) {
            return false;
          }
        }

        // Buscador multicriterio: 4 dígitos, guía completa, cliente, dirección/barrio, teléfono
        if (!q) return true;
        return (
          pkg.lastFourDigits.toLowerCase().includes(q) ||
          pkg.trackingNumber.toLowerCase().includes(q) ||
          pkg.recipientName.toLowerCase().includes(q) ||
          pkg.rawAddress.toLowerCase().includes(q) ||
          (pkg.parsedAddress?.neighborhood || '').toLowerCase().includes(q) ||
          (pkg.recipientPhone || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.deliveredAt || b.scannedAt) - (a.deliveredAt || a.scannedAt));
  }, [allPackages, searchQuery, statusFilter, dateRangeBounds]);

  const handleSaveAuditNote = async () => {
    if (!selectedPkg || selectedPkg.id === undefined) return;
    await db.packages.update(selectedPkg.id, {
      auditNote: auditNoteInput.trim()
    });
    setNoteSavedBanner('✅ Nota probatoria guardada en el expediente.');
    toast.success(`📝 Nota guardada en #${selectedPkg.lastFourDigits}`, auditNoteInput.trim() || 'Expediente actualizado');
    setTimeout(() => setNoteSavedBanner(''), 3000);
  };

  const handleUpdateAuditPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedPkg || selectedPkg.id === undefined) return;
    try {
      const base64 = await compressProofPhotoToBase64(file);
      await db.packages.update(selectedPkg.id, {
        proofPhotoBase64: base64
      });
      setNoteSavedBanner('✅ Evidencia fotográfica actualizada en el expediente.');
      toast.success(`📷 Evidencia fotográfica actualizada (#${selectedPkg.lastFourDigits})`);
      setTimeout(() => setNoteSavedBanner(''), 3000);
    } catch {
      toast.error('⚠️ No se pudo comprimir la imagen');
    }
  };

  // Compartir Prueba de Entrega por WhatsApp (Texto + Foto si navigator.share soporta archivo)
  const handleShareProofWhatsApp = async (pkg: DeliveryPackage) => {
    const exactCoords = pkg.deliveryCoordinates || pkg.coordinates;
    const mapsLink = exactCoords
      ? `https://www.google.com/maps?q=${exactCoords.lat},${exactCoords.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${pkg.rawAddress}, Medellín, Antioquia`
        )}`;

    const scanTimeStr = new Date(pkg.scannedAt).toLocaleString('es-CO');
    const delivTimeStr = pkg.deliveredAt
      ? new Date(pkg.deliveredAt).toLocaleString('es-CO')
      : 'Pendiente';

    const waitStr =
      pkg.waitTimeSeconds && pkg.waitTimeSeconds > 0
        ? `${Math.floor(pkg.waitTimeSeconds / 60)}m ${pkg.waitTimeSeconds % 60}s`
        : 'Entrega ágil (<1 min)';

    const proofText = [
      `🛡️ *EXPEDIENTE PROBATORIO DE ENTREGA - MIRUTA*`,
      `📦 *Guía iMile:* ${pkg.trackingNumber} (*#${pkg.lastFourDigits}*)`,
      `✅ *Estado:* ${
        pkg.status === 'delivered'
          ? 'ENTREGADO VERIFICADO'
          : pkg.status === 'issue'
          ? 'CON NOVEDAD / DEVUELTO'
          : 'EN RUTA'
      }`,
      `👤 *Cliente:* ${pkg.recipientName}`,
      `📞 *Teléfono:* +${pkg.recipientPhone || 'N/A'}`,
      `📍 *Dirección:* ${pkg.rawAddress} (${pkg.parsedAddress?.neighborhood || 'Medellín'})`,
      `⏱️ *Escaneo Bodega:* ${scanTimeStr}`,
      `🏁 *Fecha/Hora Exacta Entrega:* ${delivTimeStr}`,
      `⏳ *Tiempo Espera en Puerta:* ${waitStr}`,
      exactCoords
        ? `🛰️ *GPS Exacto de Entrega:* ${exactCoords.lat}, ${exactCoords.lng}`
        : '',
      `🗺️ *Ver Punto en Google Maps:* ${mapsLink}`,
      pkg.auditNote || pkg.issueNote
        ? `📝 *Nota de Auditoría:* ${pkg.auditNote || pkg.issueNote}`
        : '',
      `----------------------------------------`,
      `_Certificado por MiRuta by Christian Romero_`
    ]
      .filter(Boolean)
      .join('\n');

    // Si hay foto de evidencia y el celular soporta compartir archivo + texto
    if (pkg.proofPhotoBase64 && typeof navigator !== 'undefined' && navigator.share) {
      try {
        const res = await fetch(pkg.proofPhotoBase64);
        const blob = await res.blob();
        const file = new File([blob], `Evidencia_Guia_${pkg.lastFourDigits}.jpg`, {
          type: 'image/jpeg'
        });
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: `Prueba de Entrega Guía #${pkg.lastFourDigits}`,
            text: proofText,
            files: [file]
          });
          return;
        }
      } catch {
        // Fallback a abrir WhatsApp directo con todo el texto probatorio
      }
    }

    const waUrl = `https://wa.me/?text=${encodeURIComponent(proofText)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-2.5 space-y-3 pb-10">
      {/* Encabezado Bóveda de Trazabilidad */}
      <div
        className={`rounded-3xl border p-4 shadow-lg space-y-3 ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-950'
            : 'bg-slate-900/95 border-slate-800 text-slate-50'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-blue-600 text-white">
              <FileCheck2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black leading-tight">
                Bóveda de Trazabilidad e Historial
              </h2>
              <p className="text-xs text-slate-400">
                Respaldo probatorio con GPS, hora exacta y foto ante reclamos
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-400 font-black text-xs">
            {filteredPackages.length} guías
          </span>
        </div>

        {/* Buscador Instantáneo Multicriterio (< 50ms) */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por últimos 4 (6672), guía, cliente, dirección o celular..."
            className={`w-full pl-10 pr-8 py-2.5 rounded-2xl text-xs font-bold border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              highContrastSun
                ? 'bg-slate-50 border-slate-300 text-slate-950'
                : 'bg-slate-950 border-slate-700 text-white'
            }`}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2.5 p-1 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filtros Rápidos por Fecha (Sin scrollbar horizontal gris) */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 no-scrollbar">
          {[
            { id: 'all', label: 'Todo' },
            { id: 'today', label: 'Hoy' },
            { id: 'yesterday', label: 'Ayer' },
            { id: 'this_quincena', label: 'Quincena' },
            { id: 'last_month', label: 'Mes Ant.' },
            { id: 'custom', label: 'Rango' }
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setDateFilter(item.id as DateFilterMode)}
              className={`px-2 py-1.5 rounded-xl text-[11px] font-black text-center truncate border transition-all ${
                dateFilter === item.id
                  ? 'bg-blue-600 border-blue-500 text-white shadow-sm'
                  : 'bg-slate-800/70 border-slate-700 text-slate-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {dateFilter === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="rounded-xl px-2.5 py-1.5 text-xs font-bold bg-slate-800 border border-slate-700 text-white"
            />
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="rounded-xl px-2.5 py-1.5 text-xs font-bold bg-slate-800 border border-slate-700 text-white"
            />
          </div>
        )}

        {/* Filtros Rápidos por Estado */}
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { id: 'all', label: 'Todos' },
            { id: 'delivered', label: '✅ Entregados' },
            { id: 'issue', label: '⚠️ Novedad' },
            { id: 'pending', label: '⏳ Pendiente' }
          ].map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => setStatusFilter(st.id as StatusFilterMode)}
              className={`py-1.5 px-2 rounded-xl text-[11px] font-extrabold border ${
                statusFilter === st.id
                  ? 'bg-emerald-600 text-white border-emerald-400'
                  : 'bg-slate-800/60 border-slate-700 text-slate-300'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista de Resultados de Trazabilidad */}
      {filteredPackages.length === 0 ? (
        <div
          className={`rounded-2xl border p-6 text-center ${
            highContrastSun
              ? 'bg-white border-slate-300 text-slate-800'
              : 'bg-slate-900/70 border-slate-800 text-slate-400'
          }`}
        >
          <p className="text-xs font-bold">
            No se encontraron paquetes con los criterios seleccionados.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredPackages.map((pkg) => {
            const ts = pkg.deliveredAt || pkg.scannedAt;
            return (
              <button
                key={pkg.id ?? pkg.trackingNumber}
                type="button"
                onClick={() => handleOpenAuditModal(pkg)}
                className={`w-full text-left rounded-2xl border p-3 transition-all active:scale-[0.99] ${
                  highContrastSun
                    ? 'bg-white border-slate-300 hover:border-blue-500'
                    : 'bg-slate-900/90 border-slate-800 hover:border-blue-500/60'
                }`}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="px-2.5 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/50 text-center shrink-0">
                      <span className="block text-[9px] font-black uppercase text-amber-400">
                        GUÍA
                      </span>
                      <span className="block text-xl font-black font-mono text-amber-400 leading-none">
                        #{pkg.lastFourDigits}
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
                        {pkg.proofPhotoBase64 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">
                            📷 Con Foto
                          </span>
                        )}
                      </div>

                      <p className="text-xs font-semibold text-slate-400 truncate mt-0.5">
                        👤 {pkg.recipientName} • 📞 {pkg.recipientPhone || 'Sin tel'}
                      </p>
                      <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                        {pkg.trackingNumber} • {new Date(ts).toLocaleString('es-CO')}
                      </p>
                    </div>
                  </div>

                  <span className="text-[11px] font-black text-blue-400 shrink-0">
                    Ver Prueba →
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* MODAL DE EXPEDIENTE / DETALLE PROBATORIO DEL PAQUETE (PackageAuditModal) */}
      {selectedPkg && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 touch-scroll-y">
          <div
            className={`w-full max-w-lg rounded-t-3xl sm:rounded-3xl border p-4 pb-8 shadow-2xl max-h-[90dvh] touch-scroll-y space-y-3.5 ${
              highContrastSun
                ? 'bg-white border-slate-300 text-slate-950'
                : 'bg-slate-900 border-slate-800 text-slate-50'
            }`}
          >
            {/* Header del Expediente */}
            <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="px-3.5 py-2 rounded-2xl bg-amber-500 text-slate-950 text-center shadow-md">
                  <span className="block text-[9px] font-black uppercase leading-none">
                    ÚLTIMOS 4
                  </span>
                  <span className="block text-2xl font-black font-mono leading-none mt-0.5">
                    #{selectedPkg.lastFourDigits}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-blue-600/20 text-blue-400 border border-blue-500/30">
                    EXPEDIENTE PROBATORIO DE GUÍA
                  </span>
                  <h3 className="text-sm font-black font-mono mt-1">
                    {selectedPkg.trackingNumber}
                  </h3>
                  <p className="text-xs text-emerald-400 font-bold">
                    Tarifa liquidada: {formatCOP(selectedPkg.rate || 2200, true)}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedPkgId(null)}
                className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {noteSavedBanner && (
              <div className="p-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold text-center">
                {noteSavedBanner}
              </div>
            )}

            {/* Línea de Tiempo Exacta (Timestamps) */}
            <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
              <span className="text-[11px] font-black uppercase text-blue-400 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Línea de Tiempo Verificable (Timestamps)
              </span>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-[10px] text-slate-400 font-bold block">
                    1. ESCANEO EN BODEGA
                  </span>
                  <span className="font-mono font-bold text-slate-200">
                    {new Date(selectedPkg.scannedAt).toLocaleString('es-CO')}
                  </span>
                </div>

                <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-[10px] text-slate-400 font-bold block">
                    2. LLEGADA AL PUNTO
                  </span>
                  <span className="font-mono font-bold text-slate-200">
                    {selectedPkg.arrivedAtPointAt
                      ? new Date(selectedPkg.arrivedAtPointAt).toLocaleTimeString('es-CO')
                      : 'Directo sin espera'}
                  </span>
                </div>

                <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-[10px] text-slate-400 font-bold block">
                    3. ESPERA EN PUERTA
                  </span>
                  <span className="font-mono font-bold text-amber-400">
                    {selectedPkg.waitTimeSeconds
                      ? `${Math.floor(selectedPkg.waitTimeSeconds / 60)}m ${
                          selectedPkg.waitTimeSeconds % 60
                        }s`
                      : '0m 00s (Inmediato)'}
                  </span>
                </div>

                <div className="p-2 rounded-xl bg-emerald-950/40 border border-emerald-500/40">
                  <span className="text-[10px] text-emerald-300 font-bold block">
                    4. HORA EXACTA ENTREGA
                  </span>
                  <span className="font-mono font-black text-emerald-400">
                    {selectedPkg.deliveredAt
                      ? new Date(selectedPkg.deliveredAt).toLocaleString('es-CO')
                      : 'Pendiente'}
                  </span>
                </div>
              </div>
            </div>

            {/* Datos del Destinatario y Contacto Directo */}
            <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">
                    DESTINATARIO Y DIRECCIÓN
                  </span>
                  <p className="text-sm font-black">{selectedPkg.recipientName}</p>
                  <p className="text-xs font-bold text-blue-400 mt-0.5">
                    📍 {selectedPkg.rawAddress} ({selectedPkg.parsedAddress?.neighborhood || 'Medellín'})
                  </p>
                  <p className="text-xs font-mono text-slate-400 mt-0.5">
                    📞 +{selectedPkg.recipientPhone || 'No registrado'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <a
                  href={selectedPkg.recipientPhone ? `tel:+${selectedPkg.recipientPhone}` : '#'}
                  className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5"
                >
                  <PhoneCall className="w-3.5 h-3.5 text-blue-400" />
                  <span>Llamar Cliente</span>
                </a>
                <a
                  href={
                    selectedPkg.recipientPhone
                      ? `https://wa.me/${selectedPkg.recipientPhone}`
                      : 'https://wa.me/'
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2 px-3 rounded-xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 font-bold text-xs flex items-center justify-center gap-1.5"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>Abrir Chat WhatsApp</span>
                </a>
              </div>
            </div>

            {/* Geolocalización Exacta de Entrega (Prueba Reina) */}
            <div className="p-3 rounded-2xl bg-blue-950/50 border border-blue-500/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-blue-300 flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-blue-400" />
                  Geolocalización Exacta de Entrega
                </span>
                <span className="text-[11px] font-mono text-slate-300">
                  {(selectedPkg.deliveryCoordinates || selectedPkg.coordinates)
                    ? `${(selectedPkg.deliveryCoordinates || selectedPkg.coordinates)!.lat}, ${
                        (selectedPkg.deliveryCoordinates || selectedPkg.coordinates)!.lng
                      }`
                    : 'Medellín, ANT'}
                </span>
              </div>

              <a
                href={
                  selectedPkg.deliveryCoordinates || selectedPkg.coordinates
                    ? `https://www.google.com/maps?q=${
                        (selectedPkg.deliveryCoordinates || selectedPkg.coordinates)!.lat
                      },${(selectedPkg.deliveryCoordinates || selectedPkg.coordinates)!.lng}`
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                        `${selectedPkg.rawAddress}, Medellín, Antioquia`
                      )}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md"
              >
                <ExternalLink className="w-4 h-4 shrink-0" />
                <span>📍 VER PUNTO EXACTO DONDE SE ENTREGÓ EN GOOGLE MAPS</span>
              </a>
            </div>

            {/* Evidencia Fotográfica y Notas Aclaratorias */}
            <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-200 flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-emerald-400" />
                  Evidencia Fotográfica (Portería / Fachada / Firma)
                </span>
                <label className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-400 font-bold text-[11px] cursor-pointer">
                  {selectedPkg.proofPhotoBase64 ? 'Cambiar Foto' : '+ Subir Foto'}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleUpdateAuditPhoto}
                    className="hidden"
                  />
                </label>
              </div>

              {selectedPkg.proofPhotoBase64 ? (
                <div className="relative rounded-xl overflow-hidden border border-slate-700">
                  <img
                    src={selectedPkg.proofPhotoBase64}
                    alt={`Evidencia paquete #${selectedPkg.lastFourDigits}`}
                    onClick={() => setZoomPhotoOpen(true)}
                    className="w-full max-h-52 object-cover cursor-pointer"
                  />
                  <button
                    type="button"
                    onClick={() => setZoomPhotoOpen(true)}
                    className="absolute bottom-2 right-2 px-2.5 py-1 rounded-lg bg-black/75 text-white text-[11px] font-bold flex items-center gap-1"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                    <span>Ampliar Evidencia</span>
                  </button>
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">
                  Sin foto adjunta para esta guía. Puedes agregar una foto de respaldo arriba.
                </p>
              )}

              {/* Nota Aclaratoria Posterior */}
              <div className="pt-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                  NOTA ACLARATORIA / DETALLE DE QUIÉN RECIBIÓ
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={auditNoteInput}
                    onChange={(e) => setAuditNoteInput(e.target.value)}
                    placeholder="Ej: Recibió vigilante turno tarde / Se dejó en portería..."
                    className="flex-1 rounded-xl px-3 py-2 text-xs font-bold bg-slate-900 border border-slate-700 text-white"
                  />
                  <button
                    type="button"
                    onClick={handleSaveAuditNote}
                    className="px-3 py-2 rounded-xl bg-blue-600 text-white font-black text-xs flex items-center gap-1"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Guardar</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Botón Principal: 📤 Compartir Prueba de Entrega por WhatsApp */}
            <button
              type="button"
              onClick={() => handleShareProofWhatsApp(selectedPkg)}
              className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xl shadow-emerald-600/30"
            >
              <Share2 className="w-4 h-4 shrink-0" />
              <span>📤 COMPARTIR PRUEBA DE ENTREGA POR WHATSAPP</span>
            </button>

            {/* Si es paquete con novedad, opción directa de reintentar entrega (v9.5) */}
            {selectedPkg.status === 'issue' && (
              <button
                type="button"
                onClick={() => handleRetryIssuePackage(selectedPkg)}
                className="w-full py-3.5 px-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xl shadow-amber-500/25 active:scale-95 transition-transform cursor-pointer"
              >
                <RotateCcw className="w-4 h-4 shrink-0" />
                <span>🔄 REINTENTAR / REASIGNAR A RUTA</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modal de Zoom de Evidencia Fotográfica */}
      {zoomPhotoOpen && selectedPkg?.proofPhotoBase64 && (
        <div
          onClick={() => setZoomPhotoOpen(false)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 p-4"
        >
          <div className="max-w-2xl w-full space-y-2">
            <div className="flex items-center justify-between text-white">
              <span className="text-xs font-black font-mono">
                Guía {selectedPkg.trackingNumber} (#{selectedPkg.lastFourDigits})
              </span>
              <button
                type="button"
                onClick={() => setZoomPhotoOpen(false)}
                className="p-2 rounded-xl bg-slate-800 text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={selectedPkg.proofPhotoBase64}
              alt="Zoom evidencia"
              className="w-full max-h-[82vh] object-contain rounded-2xl border border-slate-700"
            />
          </div>
        </div>
      )}
    </div>
  );
};
