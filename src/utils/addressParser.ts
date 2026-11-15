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
 * Palabras impresas de formato en bolsas físicas de iMile (Shein/Temu) que JAMÁS deben entrar a Nombre o Dirección.
 */
const IMILE_BOILERPLATE_PATTERNS: RegExp[] = [
  /\bRef\s*No\.?\b/gi,
  /\bShip\s*Date\b/gi,
  /\bDeclared\s*value\b/gi,
  /\bUSD\b/gi,
  /\bG\.?W\.?\b/gi,
  /\bBat\s*&?\s*Category\b/gi,
  /\bNormal\b/gi,
  /\bPcs\b/gi,
  /\bQty\b/gi,
  /\bDropship\s*Order\b/gi,
  /\bYucan\b/gi,
  /\bWebsite\b/gi,
  /\bwww\.imile\.com\b/gi,
  /\bimile\.com\b/gi,
  /\bSleeve\s*blouse\b/gi,
  /\bCOL\b/gi,
  /\bMEP\b/gi,
  /\bANT\s*000[\s\-]*MEP\b/gi,
  /\b000[\s\-]*MEP\b/gi,
  /\bAC\d{3,5}\b/gi,
  /\bHome\b/gi,
  /\bDST\b/gi,
  /\bTO:?\b/gi,
  /\bFROM:?\b/gi,
  /\bDESTINATARIO:?\b/gi,
  /\bNOMBRE:?\b/gi,
  /\bTEL(?:EFONO)?:?\b/gi,
  /\bDIRECCI[OÓ]N:?\b/gi,
  /\bMEDELL[IÍ]N\b/gi,
  /\bANTIOQUIA\b/gi,
  /\bCOLOMBIA\b/gi,
];

/**
 * Sanitizador Estricto Anti-Basura (`sanitizeExtractedHumanText` - v6.0):
 * Elimina ruido de OCR de códigos de barras (ej. `A Tom] Ix. Sm © = 0 @ 8...`) y palabras de plantilla iMile.
 */
export function sanitizeExtractedHumanText(raw: string, mode: 'name' | 'address' | 'general' = 'general'): string {
  if (!raw) return '';
  let text = raw
    // 1. Eliminar símbolos de ruido de OCR prohibidos
    .replace(/[©®™@\[\]=~|{}<>$%*\\^_+!?'"`“”‘’;]/g, ' ');

  // 2. Eliminar palabras del formato impreso de la bolsa iMile
  for (const pat of IMILE_BOILERPLATE_PATTERNS) {
    text = text.replace(pat, ' ');
  }

  if (mode === 'name') {
    // Un nombre de destinatario válido SOLO puede contener letras y espacios
    text = text.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]/g, ' ');
  } else if (mode === 'address') {
    // Una dirección solo permite letras, números, #, - y espacios
    text = text.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ#\-.\s]/g, ' ');
  }

  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Valida que un supuesto nombre de cliente sea 100% humano y NO ruido de barras (`A Tom] Ix. Sm`).
 * Requiere mínimo 2 palabras alfabéticas reales, con vocales y longitud coherente.
 */
export function isValidCleanRecipientName(candidate: string): string | undefined {
  const cleaned = sanitizeExtractedHumanText(candidate, 'name');
  if (!cleaned || cleaned.length < 5) return undefined;

  const words = cleaned
    .split(/\s+/)
    .filter((w) => w.length >= 2 && /[aeiouáéíóúAEIOUÁÉÍÓÚ]/.test(w));

  // Descartar fragmentos típicos de ruido OCR cortos como "Tom Ix Sm"
  const meaningfulWords = words.filter((w) => w.length >= 3);
  if (words.length < 2 || meaningfulWords.length < 1) {
    return undefined;
  }

  // Verificar que al menos una palabra tenga >= 4 letras (ej. Alba, Lucia, Lopera, Christian, Maria, Juan)
  if (!words.some((w) => w.length >= 4)) {
    return undefined;
  }

  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Formatea una dirección de Medellín limpia en estándar `Carrera 43C # 100 - 52`
 */
export function normalizeCleanMedellinAddressString(rawAddr: string): string | undefined {
  const cleaned = sanitizeExtractedHumanText(rawAddr, 'address');
  if (!cleaned) return undefined;

  const match = cleaned.match(
    /\b(carrera|cra\.?|cr\.?|kr\.?|calle|cll\.?|cl\.?|transversal|tv\.?|diagonal|dg\.?|circular|cq\.?|avenida|av\.?)\s*(\d{1,3})\s*([a-zA-Z]{0,3})?\s*(sur)?\s*(?:#|nro\.?|no\.?|\s)\s*(\d{1,3})\s*([a-zA-Z]{0,3})?\s*(?:-|\s)\s*(\d{1,3})\b/i
  );

  if (!match) return undefined;

  const rawRoad = match[1].toLowerCase().replace('.', '');
  let roadLabel = 'Carrera';
  if (['calle', 'cll', 'cl'].includes(rawRoad)) roadLabel = 'Calle';
  else if (['transversal', 'tv'].includes(rawRoad)) roadLabel = 'Transversal';
  else if (['diagonal', 'dg'].includes(rawRoad)) roadLabel = 'Diagonal';
  else if (['circular', 'cq'].includes(rawRoad)) roadLabel = 'Circular';
  else if (['avenida', 'av'].includes(rawRoad)) roadLabel = 'Avenida';

  const mainNum = match[2];
  const mainLetter = (match[3] || '').toUpperCase();
  const surPart = match[4] ? ' Sur' : '';
  const secNum = match[5];
  const secLetter = (match[6] || '').toUpperCase();
  const plate = match[7];

  return `${roadLabel} ${mainNum}${mainLetter}${surPart} # ${secNum}${secLetter} - ${plate}`;
}

/**
 * Parser inteligente de bloque "TO" de etiquetas iMile (por voz, texto pegado o motor OCR).
 * Usa el Teléfono (`573\d{9}`) como Ancla Espacial para extraer la línea superior (Nombre)
 * y la línea inferior (Dirección), aplicando el filtro estricto anti-basura.
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
  const phoneMatch = text.match(
    /\b(57\s*3\d{2}[\s\-]?\d{3}[\s\-]?\d{4}|3\d{2}[\s\-]?\d{3}[\s\-]?\d{4})\b/
  );
  const recipientPhone = phoneMatch ? normalizeColombianPhone(phoneMatch[1]) : undefined;

  // 3. Buscar dirección válida de Medellín
  const rawAddress = normalizeCleanMedellinAddressString(text);

  // 4. Anclaje Espacial por Teléfono (`573...`) para extraer el Nombre del Destinatario sin basura
  let recipientName: string | undefined;

  if (phoneMatch && phoneMatch.index !== undefined) {
    // Tomar el texto inmediatamente anterior al teléfono (en el bloque TO de iMile el nombre siempre precede al celular)
    const beforePhone = text.slice(Math.max(0, phoneMatch.index - 90), phoneMatch.index);
    const linesBefore = beforePhone
      .split(/[\n/|]+/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (let i = linesBefore.length - 1; i >= 0; i--) {
      const validName = isValidCleanRecipientName(linesBefore[i]);
      if (validName) {
        recipientName = validName;
        break;
      }
    }
  }

  // Si no se halló por línea previa al teléfono, buscar línea limpia en el bloque sin guía/teléfono/dirección
  if (!recipientName) {
    let candidateText = text;
    if (trackingMatch) candidateText = candidateText.replace(trackingMatch[0], ' ');
    if (phoneMatch) candidateText = candidateText.replace(phoneMatch[0], ' ');
    if (rawAddress) {
      candidateText = candidateText.replace(
        /\b((?:carrera|cra\.?|cr\.?|kr\.?|calle|cll\.?|cl\.?|transversal|tv\.?|diagonal|dg\.?|circular|cq\.?)\s*\d{1,3}\s*[a-zA-Z]{0,3}\s*(?:sur)?\s*(?:#|nro|no|numero|\s)\s*\d{1,3}\s*[a-zA-Z]{0,3}\s*(?:-|\s)\s*\d{1,3})/gi,
        ' '
      );
    }

    const lines = candidateText
      .split(/[\n/|]+/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      const validName = isValidCleanRecipientName(line);
      if (validName) {
        recipientName = validName;
        break;
      }
    }
  }

  return {
    trackingNumber,
    recipientName,
    recipientPhone,
    rawAddress,
  };
}
