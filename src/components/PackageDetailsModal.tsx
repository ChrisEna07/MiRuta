import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
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
  Send,
  Edit3,
  Save,
  Package
} from 'lucide-react';
import { db, type DeliveryPackage, type PackagePackageSize, normalizeColombianPhone } from '../db/database';
import { parseMedellinAddress } from '../utils/addressParser';
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
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Consulta en vivo reactiva a IndexedDB para sincronización instantánea de estado (v10.7)
  const livePackage = useLiveQuery(
    async () => {
      if (!packageData) return null;
      if (packageData.id !== undefined) {
        const found = await db.packages.get(packageData.id);
        if (found) return found;
      }
      return await db.packages.where('trackingNumber').equals(packageData.trackingNumber).first();
    },
    [packageData?.id, packageData?.trackingNumber]
  );

  const currentPkg = livePackage || packageData;

  // Estados de los campos editables
  const [editRecipientName, setEditRecipientName] = useState<string>('');
  const [editPhone, setEditPhone] = useState<string>('');
  const [editAddress, setEditAddress] = useState<string>('');
  const [editSize, setEditSize] = useState<PackagePackageSize>('medium');
  const [editNote, setEditNote] = useState<string>('');

  useEffect(() => {
    if (currentPkg) {
      setEditRecipientName(currentPkg.recipientName || '');
      setEditPhone(currentPkg.recipientPhone || '');
      setEditAddress(currentPkg.rawAddress || '');
      setEditSize(currentPkg.packageSize || 'medium');
      setEditNote(currentPkg.issueNote || '');
    }
  }, [currentPkg?.id, currentPkg?.trackingNumber, currentPkg?.recipientName, currentPkg?.recipientPhone, currentPkg?.rawAddress, currentPkg?.packageSize, currentPkg?.issueNote]);

  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false);
      setIsSaving(false);
    }
  }, [isOpen]);

  if (!isOpen || !currentPkg) return null;

  const handleCopyAddress = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    navigator.clipboard.writeText(currentPkg.rawAddress);
    setCopied(true);
    toast.success('📋 Dirección copiada al portapapeles', currentPkg.rawAddress);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);

    try {
      const addressToSave = editAddress.trim() || currentPkg.rawAddress;
      const parsedAddr = parseMedellinAddress(addressToSave);
      const cleanPhone = normalizeColombianPhone(editPhone) || editPhone.trim();

      const updatedFields: Partial<DeliveryPackage> = {
        recipientName: editRecipientName.trim() || 'Cliente Sin Nombre',
        recipientPhone: cleanPhone,
        rawAddress: addressToSave,
        parsedAddress: parsedAddr,
        packageSize: editSize,
        issueNote: editNote.trim(),
      };

      // 1. Actualización garantizada por trackingNumber en Dexie (v10.7)
      await db.packages.update(currentPkg.trackingNumber, updatedFields);

      // 2. Si tiene id numérico, asegurar actualización atómica
      if (currentPkg.id !== undefined) {
        await db.packages.update(currentPkg.id, updatedFields);
      }

      // 3. Modificación complementaria para sincronización total de Dexie
      await db.packages.where('trackingNumber').equals(currentPkg.trackingNumber).modify(updatedFields);

      setIsEditing(false);
      toast.success(
        `✅ Guía #${currentPkg.lastFourDigits} actualizada`,
        updatedFields.recipientName
      );
    } catch (err) {
      console.error('Error al actualizar paquete:', err);
      toast.error('⚠️ No se pudieron guardar los cambios en la base local');
    } finally {
      setIsSaving(false);
    }
  };

  const navLinks = buildNavigationLinks(currentPkg);
  const arrivalWhatsAppUrl = buildArrivalWhatsAppUrl(currentPkg);
  const preNoticeWhatsAppUrl = buildWhatsAppPreNoticeUrl(currentPkg);

  const phoneDigits = (currentPkg.recipientPhone || '').replace(/\D/g, '');
  const cleanPhone = phoneDigits.startsWith('57') && phoneDigits.length === 12
    ? phoneDigits.slice(2)
    : phoneDigits;

  const isDelivered = currentPkg.status === 'delivered';
  const isIssue = currentPkg.status === 'issue';

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
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-3xl font-black font-mono text-amber-400 shrink-0">
              #{currentPkg.lastFourDigits}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-slate-400 truncate">
                  {currentPkg.trackingNumber}
                </span>
                {isDelivered && (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center gap-0.5 shrink-0">
                    <CheckCircle2 className="w-3 h-3" /> Entregado
                  </span>
                )}
                {isIssue && (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 flex items-center gap-0.5 shrink-0">
                    <AlertTriangle className="w-3 h-3" /> Novedad
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Tanda {currentPkg.batchNumber || 1} • Orden #{currentPkg.routeOrder || 1}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isEditing ? (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="py-1.5 px-3 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 font-black text-xs flex items-center gap-1 active:scale-95 transition-all cursor-pointer"
                title="Editar datos del paquete"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Editar</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
              >
                Cancelar
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Contenido / Detalles o Formulario de Edición */}
        <div className="p-4 space-y-3.5 overflow-y-auto flex-1 touch-scroll-y">
          {isEditing ? (
            /* MODO EDICIÓN ACTIVO (Hotfix v10.7) */
            <form onSubmit={handleSaveEdit} className="space-y-3.5">
              <div className="p-3 rounded-2xl bg-blue-950/40 border border-blue-500/40 text-xs text-blue-300 flex items-center gap-2">
                <Edit3 className="w-4 h-4 shrink-0 text-blue-400" />
                <span>
                  Edita o completa los datos faltantes. Al guardar, se sincronizarán de inmediato en toda la ruta.
                </span>
              </div>

              {/* Input Destinatario */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1">
                  <span>👤 Nombre del Destinatario:</span>
                </label>
                <input
                  type="text"
                  value={editRecipientName}
                  onChange={(e) => setEditRecipientName(e.target.value)}
                  placeholder="Ej. Juan Pérez"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-bold text-sm focus:outline-none focus:border-amber-400"
                />
              </div>

              {/* Input Celular / Teléfono */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1">
                  <span>📞 Celular / Teléfono de Contacto:</span>
                </label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="Ej. 300 123 4567"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-emerald-400 font-mono font-bold text-sm focus:outline-none focus:border-amber-400"
                />
              </div>

              {/* Input Dirección */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1">
                  <span>📍 Dirección de Entrega:</span>
                </label>
                <input
                  type="text"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  placeholder="Ej. Carrera 43C # 100 - 52"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-bold text-sm focus:outline-none focus:border-amber-400"
                />
              </div>

              {/* Selector de Tamaño de Moto */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1">
                  <span>🛵 Tamaño / Volumen en Moto:</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditSize('small')}
                    className={`py-2 px-2 rounded-xl text-xs font-black border transition-all ${
                      editSize === 'small'
                        ? 'bg-blue-600 text-white border-blue-400 shadow-md'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    🎒 Pequeño
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditSize('medium')}
                    className={`py-2 px-2 rounded-xl text-xs font-black border transition-all ${
                      editSize === 'medium'
                        ? 'bg-emerald-600 text-white border-emerald-400 shadow-md'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    📦 Mediano
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditSize('large')}
                    className={`py-2 px-2 rounded-xl text-xs font-black border transition-all ${
                      editSize === 'large'
                        ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-md'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    ⚠️ Grande
                  </button>
                </div>
              </div>

              {/* Input Nota de Novedad */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1">
                  <span>📝 Nota o Novedad (Opcional):</span>
                </label>
                <input
                  type="text"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="Ej. Dejar con el vigilante o volver después de las 7pm"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-amber-400"
                />
              </div>

              {/* Botón Guardar Cambios */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 via-emerald-600 to-green-600 hover:from-emerald-400 hover:to-green-500 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-xl shadow-emerald-500/25 active:scale-95 transition-all cursor-pointer border border-emerald-300 disabled:opacity-50"
                >
                  <Save className="w-4 h-4 fill-slate-950" />
                  <span>{isSaving ? 'Guardando en Base Local...' : '💾 GUARDAR Y ACTUALIZAR PAQUETE'}</span>
                </button>
              </div>
            </form>
          ) : (
            /* MODO LECTURA Y OPERACIÓN NORMAL */
            <>
              {/* Tamaño de Bulto y Capacidad */}
              <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">Capacidad / Ubicación en Moto:</span>
                <PackageSizeBadge size={currentPkg.packageSize} variant="pill" />
              </div>

              {/* Dirección y Acción de Copiado */}
              <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      📍 DIRECCIÓN DE ENTREGA
                    </span>
                    <p className="text-sm font-black text-white mt-0.5 leading-snug">
                      {currentPkg.rawAddress}
                    </p>
                    <p className="text-xs text-blue-400 font-semibold mt-0.5">
                      Barrio: {currentPkg.parsedAddress?.neighborhood || 'Medellín'}
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
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      👤 CLIENTE / DESTINATARIO
                    </span>
                    <p className="text-sm font-black text-white mt-0.5">
                      {currentPkg.recipientName || 'Sin destinatario registrado'}
                    </p>
                    {currentPkg.recipientPhone ? (
                      <p className="text-xs font-mono text-emerald-400 mt-0.5">
                        📞 +{currentPkg.recipientPhone}
                      </p>
                    ) : (
                      <p className="text-xs font-bold text-amber-400/90 mt-0.5">
                        ⚠️ Sin teléfono registrado
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="p-1.5 rounded-lg bg-slate-850 hover:bg-slate-750 text-slate-300 text-xs border border-slate-700 flex items-center gap-1 shrink-0"
                    title="Editar destinatario o teléfono"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-blue-400" />
                    <span>Editar</span>
                  </button>
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

                  {currentPkg.recipientPhone && (
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
              {currentPkg.issueNote && (
                <div className="p-3 rounded-2xl bg-rose-950/40 border border-rose-500/50 text-xs">
                  <span className="font-bold text-rose-300 block mb-0.5">⚠️ Nota / Novedad Registrada:</span>
                  <p className="text-slate-200">{currentPkg.issueNote}</p>
                </div>
              )}

              {/* Acciones de Ruta */}
              <div className="pt-1 space-y-2">
                {!isDelivered && onPinAsNextStop && (
                  <button
                    type="button"
                    onClick={() => {
                      onPinAsNextStop(currentPkg);
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
                      onRetryNovelty(currentPkg);
                      onClose();
                    }}
                    className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>🔄 Reintentar / Reasignar a Ruta</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
