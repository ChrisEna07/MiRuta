import { type DeliveryPackage } from '../db/database';

/**
 * Formatea un número en pesos colombianos ($ 2.200 COP)
 */
export function formatCOP(value: number, includeSuffix = false): string {
  const rounded = Math.round(value || 0);
  const formatted = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0
  }).format(rounded);
  return includeSuffix ? `${formatted} COP` : formatted;
}

/**
 * Reproduce un sonido sutil de caja registradora / entrega exitosa usando Web Audio API (100% Offline)
 * y activa vibración táctil en el celular.
 */
export function playCashRegisterSuccess(): void {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([70, 40, 130]);
    }
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(1046.5, now);
    osc1.frequency.setValueAtTime(1318.5, now + 0.08);
    gain1.gain.setValueAtTime(0.22, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.36);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(2093, now + 0.09);
    gain2.gain.setValueAtTime(0.18, now + 0.09);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.09);
    osc2.stop(now + 0.46);
  } catch {
    // Ignorar si el navegador bloquea audio sin gesto previo
  }
}

/**
 * Comprime cualquier foto tomada con la cámara a JPEG < 75KB usando HTML5 Canvas
 * para guardar evidencia de fachada/entrega en IndexedDB sin saturar el almacenamiento.
 */
export async function compressProofPhotoToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 720;
        let width = img.width;
        let height = img.height;

        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No se pudo inicializar Canvas'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        // Sello de agua táctico con marca MiRuta by Christian Romero
        ctx.fillStyle = 'rgba(15, 23, 42, 0.76)';
        ctx.fillRect(0, height - 28, width, 28);
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`MiRuta by Christian Romero • ${new Date().toLocaleString('es-CO')}`, 10, height - 10);

        let quality = 0.65;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > 98000 && quality > 0.25) {
          quality -= 0.12;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Error leyendo imagen'));
      img.src = String(e.target?.result || '');
    };
    reader.onerror = () => reject(new Error('Error abriendo archivo'));
    reader.readAsDataURL(file);
  });
}

/**
 * Saludo dinámico según la hora del día (v10.6)
 */
export const getDynamicGreeting = () => {
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 18) return "Buenas tardes";
  return "Buenas noches disculpe la hora";
};

/**
 * Construye el enlace de WhatsApp 1-Click para pre-avisar al cliente ("Voy en camino") (v10.9).
 */
export function buildWhatsAppPreNoticeUrl(pkg: DeliveryPackage): string {
  const phone = (pkg.recipientPhone || '').replace(/\D/g, '');
  const cleanPhone = phone.startsWith('57') && phone.length === 12
    ? phone.slice(2)
    : phone;

  const last4 = pkg.trackingNumber.slice(-4);
  const recipientName = pkg.recipientName?.trim() || 'Cliente';

  const text = `${getDynamicGreeting()} ${recipientName}, soy su repartidor. Llevo su paquete con terminación #${last4}. ¿Me confirma si la dirección ${pkg.rawAddress} es correcta? Si es diferente o difícil de llegar, por favor envíeme su ubicación actual para llegar más rápido.`;
  if (cleanPhone.length >= 10) {
    return `https://wa.me/57${cleanPhone}?text=${encodeURIComponent(text)}`;
  }
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Enlace de WhatsApp "Ya estoy acá" al llegar a la puerta del cliente.
 */
export function buildArrivalWhatsAppUrl(pkg: DeliveryPackage): string {
  const phone = (pkg.recipientPhone || '').replace(/\D/g, '');
  const cleanPhone = phone.startsWith('57') && phone.length === 12
    ? phone.slice(2)
    : phone;

  const text = `${getDynamicGreeting()}, ya llegue al punto de entrega que indica la direccion me puede recibir?`;
  if (cleanPhone.length >= 10) {
    return `https://wa.me/57${cleanPhone}?text=${encodeURIComponent(text)}`;
  }
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Normaliza la dirección para navegación blindando zona y evitando saltos de río al sur o Robledo
 */
export function formatNavQueryAddress(address: string, neighborhood?: string): string {
  let clean = address.trim().replace(/,\s*(Medell[íi]n|Antioquia|Colombia).*$/gi, '');
  if (neighborhood && !clean.toLowerCase().includes(neighborhood.toLowerCase())) {
    return `${clean}, ${neighborhood}, Medellín, Antioquia, Colombia`;
  }
  return `${clean}, Medellín, Antioquia, Colombia`;
}

/**
 * Construye enlaces de navegación directa para Waze y Google Maps en Medellín.
 */
export function buildNavigationLinks(pkg: DeliveryPackage): { wazeUrl: string; googleMapsUrl: string } {
  const queryAddress = formatNavQueryAddress(pkg.rawAddress, pkg.parsedAddress?.neighborhood);

  if (pkg.coordinates && pkg.coordinates.lat && pkg.coordinates.lng) {
    const { lat, lng } = pkg.coordinates;
    return {
      wazeUrl: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
      googleMapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(queryAddress)}&travelmode=two-wheeler`
    };
  }

  return {
    wazeUrl: `https://waze.com/ul?q=${encodeURIComponent(queryAddress)}&navigate=yes`,
    googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryAddress)}`
  };
}

/**
 * Abre la app nativa de Waze o el portal web con la ruta pre-cargada
 * hacia la dirección normalizada de Medellín en un solo toque (deep link con fallback).
 */
export function openWazeNavigation(
  address: string,
  coords?: { lat: number; lng: number } | null,
  neighborhood?: string
): void {
  if (!address && !coords) return;

  const queryAddress = formatNavQueryAddress(address, neighborhood);

  const webUrl = coords?.lat && coords?.lng
    ? `https://waze.com/ul?ll=${coords.lat},${coords.lng}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(queryAddress)}&navigate=yes`;

  const appScheme = coords?.lat && coords?.lng
    ? `waze://?ll=${coords.lat},${coords.lng}&navigate=yes`
    : `waze://?q=${encodeURIComponent(queryAddress)}&navigate=yes`;

  if (typeof window !== 'undefined') {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) {
      try {
        window.location.href = appScheme;
        setTimeout(() => {
          window.open(webUrl, '_blank');
        }, 500);
        return;
      } catch {
        window.open(webUrl, '_blank');
        return;
      }
    }
    window.open(webUrl, '_blank');
  }
}
