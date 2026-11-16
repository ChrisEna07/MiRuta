import React, { useState } from 'react';
import {
  X,
  Copy,
  MapPin,
  Phone,
  MessageCircle,
  CheckCircle2,
  AlertTriangle,
  Map,
  Crosshair,
  RotateCcw,
  Check,
  Send
} from 'lucide-react';
import { type DeliveryPackage } from '../db/database';
import {
  buildArrivalWhatsAppUrl,
  buildWhatsAppPreNoticeUrl,
  getDynamicGreeting,
  buildNavigationLinks
} from '../utils/mediaAndFeedback';
import { PackageSizeBadge } from './PackageSizeBadge';
import { useToast } from './ui/FeedbackSystem';

interface PackageDetailsModalProps {
  packageData: DeliveryPackage | null;
  isOpen: boolean;
  onClose: () => void;
  onPinAsNextStop?: (pkg: DeliveryPackage) => void;
  onRetryNovelty?: (pkg: DeliveryPackage) => void;
  highContrastSun?: boolean;
}

export const PackageDetailsModal: React.FC<PackageDetailsModalProps> = ({
  packageData,
  isOpen,
  onClose,
  onPinAsNextStop,
  onRetryNovelty,
  highContrastSun = false,
}) => {
  const toast = useToast();
  const [copied, setCopied] = useState<boolean>(false);

  if (!isOpen || !packageData) return null;

  const handleCopyAddress = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    navigator.clipboard.writeText(packageData.rawAddress);
    setCopied(true);
    toast.success('📋 Dirección copiada al portapapeles', packageData.rawAddress);
    setTimeout(() => setCopied(false), 2000);
  };

  const navLinks = buildNavigationLinks(packageData);
  const arrivalWhatsAppUrl = buildArrivalWhatsAppUrl(packageData);
  const preNoticeWhatsAppUrl = buildWhatsAppPreNoticeUrl(packageData);

  const phoneDigits = (packageData.recipientPhone || '').replace(/\D/g, '');
  const cleanPhone = phoneDigits.startsWith('57') && phoneDigits.length === 12
    ? phoneDigits.slice(2)
    : phoneDigits;

  const isDelivered = packageData.status === 'delivered';
  const isIssue = packageData.status === 'issue';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-5 touch-scroll-y animate-in fade-in duration-150">
      <div
        className={`w-full max-w-lg rounded-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[90dvh] ${
          highContrastSun
            ? 'bg-white border-slate-300 text-slate-950'
            : 'bg-slate-900 border-slate-700 text-slate-100'
        }`}
      >
        {/* Cabecera */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-3xl font-black font-mono text-amber-400">
              #{packageData.lastFourDigits}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-400">
                  {packageData.trackingNumber}
                </span>
                {isDelivered && (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center gap-0.5">
                    <CheckCircle2 className="w-3 h-3" /> Entregado
                  </span>
                )}
                {isIssue && (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 flex items-center gap-0.5">
                    <AlertTriangle className="w-3 h-3" /> Novedad
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                Tanda {packageData.batchNumber || 1} • Orden #{packageData.routeOrder || 1}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido / Detalles */}
        <div className="p-4 space-y-3.5 overflow-y-auto flex-1 touch-scroll-y">
          {/* Tamaño de Bulto y Capacidad */}
          <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400">Capacidad / Ubicación en Moto:</span>
            <PackageSizeBadge size={packageData.packageSize} variant="pill" />
          </div>

          {/* Dirección y Acción de Copiado */}
          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  📍 DIRECCIÓN DE ENTREGA
                </span>
                <p className="text-sm font-black text-white mt-0.5 leading-snug">
                  {packageData.rawAddress}
                </p>
                <p className="text-xs text-blue-400 font-semibold mt-0.5">
                  Barrio: {packageData.parsedAddress?.neighborhood || 'Medellín'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={handleCopyAddress}
                className="py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? '¡Copiada!' : '📋 Copiar Dirección'}</span>
              </button>

              <a
                href={navLinks.googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-black text-xs flex items-center justify-center gap-1.5 border border-slate-700 active:scale-95 transition-all"
              >
                <Map className="w-4 h-4 text-blue-400" />
                <span>Google Maps</span>
              </a>
            </div>
          </div>

          {/* Destinatario y Contacto */}
          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                👤 CLIENTE / DESTINATARIO
              </span>
              <p className="text-sm font-black text-white mt-0.5">
                {packageData.recipientName || 'Sin destinatario registrado'}
              </p>
              {packageData.recipientPhone && (
                <p className="text-xs font-mono text-emerald-400 mt-0.5">
                  📞 +{packageData.recipientPhone}
                </p>
              )}
            </div>

            {/* Mensajería de WhatsApp Dinámica v10.6 */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                💬 MENSAJES DIRECTOS WHATSAPP (CON SALUDO AUTOMÁTICO)
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* Botón Pre-Aviso ("Voy en camino") */}
                <a
                  href={preNoticeWhatsAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2.5 px-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>💬 "Voy en camino"</span>
                </a>

                {/* Botón Llegada ("Ya estoy acá") */}
                <a
                  href={arrivalWhatsAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all"
                >
                  <MessageCircle className="w-3.5 h-3.5 fill-slate-950" />
                  <span>📍 "Ya estoy acá"</span>
                </a>
              </div>

              {packageData.recipientPhone && (
                <a
                  href={`tel:+${cleanPhone}`}
                  className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 border border-slate-700 active:scale-95 transition-all"
                >
                  <Phone className="w-3.5 h-3.5 text-blue-400" />
                  <span>Llamar al Cliente ({cleanPhone})</span>
                </a>
              )}
            </div>
          </div>

          {/* Novedades o Notas de Entrega */}
          {packageData.issueNote && (
            <div className="p-3 rounded-2xl bg-rose-950/40 border border-rose-500/50 text-xs">
              <span className="font-bold text-rose-300 block mb-0.5">⚠️ Nota / Novedad Registrada:</span>
              <p className="text-slate-200">{packageData.issueNote}</p>
            </div>
          )}

          {/* Acciones de Ruta */}
          <div className="pt-1 space-y-2">
            {!isDelivered && onPinAsNextStop && (
              <button
                type="button"
                onClick={() => {
                  onPinAsNextStop(packageData);
                  onClose();
                }}
                className="w-full py-3 px-4 rounded-xl bg-blue-600/20 border border-blue-500/40 hover:bg-blue-600/30 text-blue-300 font-black text-xs flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer"
              >
                <Crosshair className="w-4 h-4" />
                <span>🎯 Fijar como Siguiente Parada</span>
              </button>
            )}

            {isIssue && onRetryNovelty && (
              <button
                type="button"
                onClick={() => {
                  onRetryNovelty(packageData);
                  onClose();
                }}
                className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>🔄 Reintentar / Reasignar a Ruta</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
