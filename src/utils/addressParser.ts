import { type ParsedMedellinAddress, type RoadMainType, type DeliveryPackage, normalizeColombianPhone } from '../db/database';

const MEDELLIN_NEIGHBORHOODS = [
  'El Poblado', 'Laureles', 'Belén', 'Castilla', 'Robledo', 'Aranjuez', 'Manrique',
  'Buenos Aires', 'La América', 'La Candelaria', 'Estadio', 'Guayabal', 'San Javier',
  'Popular', 'Santa Cruz', 'Doce de Octubre', 'Villa Hermosa', 'San Antonio de Prado',
  'Sabaneta', 'Envigado', 'Itagüí', 'Bello', 'Calasanz', 'Los Colores', 'Conquistadores',
  'Boston', 'Prado', 'Campo Valdés', 'Pedregal', 'Floresta', 'Rosales', 'Loma de los Bernal',
  'Ciudad del Río', 'Patio Bonito', 'Provenza', 'Astorga', 'Manila', 'Castropol', 'Lalinde'
];

export function parseMedellinAddress(rawInput: string, defaultNeighborhood = ''): ParsedMedellinAddress {
  const raw = (rawInput || '').trim();
  const normalized = raw
    .replace(/\s+/g, ' ')
    .replace(/N[°ºo]\.?/gi, '#')
    .replace(/nro\.?/gi, '#')
    .replace(/num(?:ero)?\.?/gi, '#');

  // Identify main road type
  let mainType: RoadMainType = 'CR';
  const typeMatch = normalized.match(
    /\b(carrera|cra\.?|cr\.?|kr\.?|k\.?|calle|cll\.?|cl\.?|c\.?|transversal|tv\.?|tr\.?|transv\.?|diagonal|dg\.?|diag\.?|circular|cq\.?|circ\.?|avenida|av\.?)\b/i
  );

  if (typeMatch) {
    const token = typeMatch[1].toLowerCase().replace('.', '');
    if (['carrera', 'cra', 'cr', 'kr', 'k'].includes(token)) mainType = 'CR';
    else if (['calle', 'cll', 'cl', 'c'].includes(token)) mainType = 'CL';
    else if (['transversal', 'tv', 'tr', 'transv'].includes(token)) mainType = 'TV';
    else if (['diagonal', 'dg', 'diag'].includes(token)) mainType = 'DG';
    else if (['circular', 'cq', 'circ'].includes(token)) mainType = 'CQ';
    else if (['avenida', 'av'].includes(token)) mainType = 'AV';
  }

  // Regex for Colombian address nomenclature:
  // Examples:
  // "Carrera 43c #100 52"
  // "Cl 10 Sur # 43A - 18"
  // "CR 76 # 32B-14 Int 201"
  const regex =
    /(?:carrera|cra\.?|cr\.?|kr\.?|k\.?|calle|cll\.?|cl\.?|c\.?|transversal|tv\.?|tr\.?|transv\.?|diagonal|dg\.?|diag\.?|circular|cq\.?|circ\.?|avenida|av\.?)?\s*(\d{1,3})\s*([a-zA-Z]{0,3})?\s*(sur)?\s*(?:#|-|No\.?|con\s+(?:calle|cl|cra|cr)?)?\s*(\d{1,3})\s*([a-zA-Z]{0,3})?\s*(sur)?\s*(?:-|\s+)?\s*(\d{1,3})?/i;

  const match = normalized.match(regex);

  let mainNum = 0;
  let mainLetter = '';
  let isSur = /\bsur\b/i.test(normalized);
  let secNum = 0;
  let secLetter = '';
  let plate = 0;

  if (match) {
    mainNum = parseInt(match[1] || '0', 10) || 0;
    mainLetter = (match[2] || '').toUpperCase();
    if (match[3]) isSur = true;
    secNum = parseInt(match[4] || '0', 10) || 0;
    secLetter = (match[5] || '').toUpperCase();
    plate = parseInt(match[7] || '0', 10) || 0;
  }

  // Detect apartment / interior / tower / residential unit
  const unitMatch = normalized.match(
    /\b((?:apto|apartamento|int|interior|torre|bloque|casa|local|oficina|unidad|edificio|urb)\s*[a-zA-Z0-9\-]+(?:\s+(?:apto|int|casa)\s*[a-zA-Z0-9\-]+)?)/i
  );
  const apartmentOrUnit = unitMatch ? unitMatch[1].trim() : undefined;

  // Detect neighborhood
  let neighborhood = defaultNeighborhood;
  for (const nb of MEDELLIN_NEIGHBORHOODS) {
    if (normalized.toLowerCase().includes(nb.toLowerCase())) {
      neighborhood = nb;
      break;
    }
  }

  // Compute blockKey for grouping packages on the exact same block or residential unit
  // In Medellín, e.g. Carrera 43C # 100-52 and Carrera 43C # 100-18 share the block "CR43C-100"
  const blockKey =
    mainNum > 0 && secNum > 0
      ? `${mainType}${mainNum}${mainLetter}${isSur ? 'S' : ''}-${secNum}${secLetter}`
      : normalized.toUpperCase().slice(0, 18);

  return {
    mainType,
    mainNum,
    mainLetter,
    isSur,
    secNum,
    secLetter,
    plate,
    neighborhood: neighborhood || 'Medellín',
    apartmentOrUnit,
    blockKey
  };
}

export interface SameBlockAlert {
  blockKey: string;
  humanLabel: string;
  packages: DeliveryPackage[];
}

/**
 * Detecta automáticamente paquetes pendientes o en curso que están en la misma cuadra o unidad residencial.
 */
export function detectSameBlockClusters(packages: DeliveryPackage[]): SameBlockAlert[] {
  const active = packages.filter((p) => p.status === 'pending' || p.status === 'in_progress');
  const map = new Map<string, DeliveryPackage[]>();

  for (const pkg of active) {
    const key = pkg.parsedAddress?.blockKey || parseMedellinAddress(pkg.rawAddress).blockKey;
    if (!key) continue;
    const list = map.get(key) || [];
    list.push(pkg);
    map.set(key, list);
  }

  const alerts: SameBlockAlert[] = [];
  for (const [blockKey, list] of map.entries()) {
    if (list.length >= 2) {
      const first = list[0].parsedAddress;
      const humanLabel =
        first && first.mainNum > 0
          ? `${first.mainType} ${first.mainNum}${first.mainLetter}${first.isSur ? ' Sur' : ''} con #${first.secNum}${first.secLetter}`
          : list[0].rawAddress;
      alerts.push({
        blockKey,
        humanLabel,
        packages: list
      });
    }
  }
  return alerts;
}

/**
 * Parser inteligente de bloque "TO" de etiquetas iMile (por voz o texto pegado/OCR).
 * Extrae código de barras (si viene), teléfono 573..., dirección y nombre del destinatario.
 */
export function parseIMileLabelBlock(rawText: string): {
  trackingNumber?: string;
  recipientName?: string;
  recipientPhone?: string;
  rawAddress?: string;
} {
  const text = (rawText || '').trim();
  if (!text) return {};

  // 1. Buscar guía iMile (12 a 15 dígitos, ej. 6103026696672)
  const trackingMatch = text.match(/\b(6\d{11,14}|\d{12,15})\b/);
  const trackingNumber = trackingMatch ? trackingMatch[1] : undefined;

  // 2. Buscar teléfono celular colombiano (573XXXXXXXXX o 3XXXXXXXXX)
  const phoneMatch = text.match(/\b(57\s*3\d{2}[\s\-]?\d{3}[\s\-]?\d{4}|3\d{2}[\s\-]?\d{3}[\s\-]?\d{4})\b/);
  const recipientPhone = phoneMatch ? normalizeColombianPhone(phoneMatch[1]) : undefined;

  // 3. Buscar dirección (Carrera / Calle / Tv / Dg / Cq)
  const addressMatch = text.match(
    /\b((?:carrera|cra\.?|cr\.?|kr\.?|calle|cll\.?|cl\.?|transversal|tv\.?|diagonal|dg\.?|circular|cq\.?)\s*\d{1,3}\s*[a-zA-Z]{0,3}\s*(?:sur)?\s*(?:#|nro|no|numero|\s)\s*\d{1,3}\s*[a-zA-Z]{0,3}\s*(?:-|\s)\s*\d{1,3}(?:[^\n,;.]{0,25}))/i
  );
  const rawAddress = addressMatch ? addressMatch[1].trim() : undefined;

  // 4. El resto limpio suele ser el nombre del cliente
  let leftover = text;
  if (trackingMatch) leftover = leftover.replace(trackingMatch[0], '');
  if (phoneMatch) leftover = leftover.replace(phoneMatch[0], '');
  if (addressMatch) leftover = leftover.replace(addressMatch[0], '');
  leftover = leftover
    .replace(/\b(TO:?|DESTINATARIO:?|NOMBRE:?|TEL:?|DIRECCION:?|MEDELLIN|ANTIOQUIA|COLOMBIA)\b/gi, '')
    .replace(/[,;|\-\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const recipientName = leftover.length >= 3 ? leftover : undefined;

  return {
    trackingNumber,
    recipientName,
    recipientPhone,
    rawAddress
  };
}
