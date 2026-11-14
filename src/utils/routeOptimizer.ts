import { type DeliveryPackage, db } from '../db/database';
import { parseMedellinAddress } from './addressParser';

export type SweepDirection = 'asc' | 'desc' | 'snake';

/**
 * Convierte cualquier nomenclatura vial de Medellín a un eje estandarizado:
 * - Eje Carrera (Oriente-Occidente): CR / TV
 * - Eje Calle (Sur-Norte): CL / DG
 * De este modo "Carrera 43C # 100 - 52" y "Calle 100 # 43C - 10" quedan posicionadas en el mismo cruce.
 */
function getGridCoordinates(pkg: DeliveryPackage): {
  carreraAxis: number;
  carreraLetterWeight: number;
  calleAxis: number;
  calleLetterWeight: number;
  plate: number;
  blockKey: string;
} {
  const parsed = pkg.parsedAddress?.mainNum
    ? pkg.parsedAddress
    : parseMedellinAddress(pkg.rawAddress);

  const letterToFraction = (letter: string): number => {
    if (!letter) return 0;
    let sum = 0;
    const upper = letter.toUpperCase();
    for (let i = 0; i < upper.length; i++) {
      sum += (upper.charCodeAt(i) - 64) / Math.pow(30, i + 1);
    }
    return sum;
  };

  const mainVal = (parsed.isSur ? -parsed.mainNum : parsed.mainNum) + letterToFraction(parsed.mainLetter);
  const secVal = parsed.secNum + letterToFraction(parsed.secLetter);

  // Si la vía principal es Carrera o Transversal, el eje principal es Carrera y el secundario es Calle
  if (parsed.mainType === 'CR' || parsed.mainType === 'TV' || parsed.mainType === 'AV') {
    return {
      carreraAxis: mainVal,
      carreraLetterWeight: letterToFraction(parsed.mainLetter),
      calleAxis: secVal,
      calleLetterWeight: letterToFraction(parsed.secLetter),
      plate: parsed.plate || 0,
      blockKey: parsed.blockKey
    };
  }

  // Si la vía principal es Calle, Diagonal o Circular, el eje principal es Calle y el secundario es Carrera
  return {
    carreraAxis: secVal,
    carreraLetterWeight: letterToFraction(parsed.secLetter),
    calleAxis: mainVal,
    calleLetterWeight: letterToFraction(parsed.mainLetter),
    plate: parsed.plate || 0,
    blockKey: parsed.blockKey
  };
}

/**
 * NIVEL 1: Enrutamiento Offline en Serpiente / Barrido de Sector por Nomenclatura de Medellín.
 * Agrupa primero paquetes de la misma cuadra/unidad y recorre las Carreras en zig-zag (serpiente)
 * para no devolverse en vacío por la misma loma o cuadra.
 */
export function sortPackagesOfflineSnake(
  packages: DeliveryPackage[],
  direction: SweepDirection = 'snake',
  primaryAxis: 'CR' | 'CL' = 'CR'
): DeliveryPackage[] {
  const copy = [...packages];

  copy.sort((a, b) => {
    // Primero los pendientes/en curso antes que los ya entregados
    const aActive = a.status === 'pending' || a.status === 'in_progress' ? 0 : 1;
    const bActive = b.status === 'pending' || b.status === 'in_progress' ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;

    const ga = getGridCoordinates(a);
    const gb = getGridCoordinates(b);

    // Si están en la misma cuadra exacta, van pegados ordenados por placa
    if (ga.blockKey && ga.blockKey === gb.blockKey) {
      return ga.plate - gb.plate;
    }

    const firstA = primaryAxis === 'CR' ? Math.round(ga.carreraAxis) : Math.round(ga.calleAxis);
    const firstB = primaryAxis === 'CR' ? Math.round(gb.carreraAxis) : Math.round(gb.calleAxis);

    if (firstA !== firstB) {
      return direction === 'desc' ? firstB - firstA : firstA - firstB;
    }

    const secondA = primaryAxis === 'CR' ? ga.calleAxis + ga.plate / 200 : ga.carreraAxis + ga.plate / 200;
    const secondB = primaryAxis === 'CR' ? gb.calleAxis + gb.plate / 200 : gb.carreraAxis + gb.plate / 200;

    if (direction === 'snake') {
      // En barrido serpiente, las carreras pares suben por calle y las impares bajan por calle
      const isEvenStrip = Math.abs(firstA) % 2 === 0;
      return isEvenStrip ? secondA - secondB : secondB - secondA;
    }

    return direction === 'desc' ? secondB - secondA : secondA - secondB;
  });

  return copy;
}

/**
 * Calcula distancia Haversine en kilómetros entre dos coordenadas GPS.
 */
export function haversineDistanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const c =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng;
  return 2 * R * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

/**
 * Aproximación de coordenadas en el Valle de Aburrá (Medellín) basada en nomenclatura Calle/Carrera
 * cuando un paquete aún no tiene coordenadas GPS o Nominatim no encuentra una placa específica.
 * Centro de referencia en Medellín: Calle 50 (Colombia) con Carrera 50 (Palacé) -> 6.2518, -75.5683
 */
export function estimateMedellinCoordinatesFromAddress(pkg: DeliveryPackage): { lat: number; lng: number } {
  if (pkg.coordinates && pkg.coordinates.lat && pkg.coordinates.lng) {
    return pkg.coordinates;
  }
  const grid = getGridCoordinates(pkg);
  // En Medellín:
  // Cada Calle (~80m) incrementa latitud hacia el Norte (~0.00072 grados por calle)
  // Cada Carrera (~80m) incrementa longitud hacia el Occidente (~-0.00072 grados por carrera)
  const baseLat = 6.2115; // Referencia Calle 1
  const baseLng = -75.5320; // Referencia Carrera 1
  const calleVal = grid.calleAxis || 50;
  const carreraVal = grid.carreraAxis || 50;
  const plateOffset = (grid.plate || 20) / 100;

  return {
    lat: Number((baseLat + (calleVal + plateOffset * 0.5) * 0.00075).toFixed(6)),
    lng: Number((baseLng - (carreraVal + plateOffset * 0.5) * 0.00075).toFixed(6))
  };
}

/**
 * Geocodifica una dirección en Medellín usando Nominatim OpenStreetMap con rate-limit seguro,
 * y cae automáticamente al estimador cartográfico de Medellín si no hay resultado exacto.
 */
export async function geocodeMedellinAddress(pkg: DeliveryPackage): Promise<{ lat: number; lng: number }> {
  if (pkg.coordinates && pkg.coordinates.lat && pkg.coordinates.lng) {
    return pkg.coordinates;
  }
  try {
    const query = `${pkg.rawAddress}, Medellín, Antioquia, Colombia`;
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'Accept-Language': 'es-CO,es;q=0.9'
      }
    });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0 && data[0].lat && data[0].lon) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon)
        };
      }
    }
  } catch {
    // Fallback silencioso a estimación por cuadrícula de Medellín
  }
  return estimateMedellinCoordinatesFromAddress(pkg);
}

/**
 * Algoritmo Heurístico TSP (Nearest Neighbor + mejora 2-opt) desde la posición actual del repartidor.
 */
export function solveTSPNearestNeighbor2Opt(
  packages: DeliveryPackage[],
  startCoords: { lat: number; lng: number }
): DeliveryPackage[] {
  const active = packages.filter((p) => p.status === 'pending' || p.status === 'in_progress');
  const completed = packages.filter((p) => p.status !== 'pending' && p.status !== 'in_progress');

  if (active.length <= 1) {
    return [...active, ...completed];
  }

  // Asegurar coordenadas para cada paquete activo
  const nodes = active.map((pkg) => ({
    pkg,
    coords: pkg.coordinates || estimateMedellinCoordinatesFromAddress(pkg)
  }));

  // 1. Construcción voraz Nearest Neighbor agrupando misma cuadra
  const visited = new Set<number>();
  const orderedNodes: typeof nodes = [];
  let currentPos = startCoords;

  while (orderedNodes.length < nodes.length) {
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < nodes.length; i++) {
      if (visited.has(i)) continue;
      const d = haversineDistanceKm(currentPos, nodes[i].coords);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;
    visited.add(bestIdx);
    const chosen = nodes[bestIdx];
    orderedNodes.push(chosen);
    currentPos = chosen.coords;

    // Agregar inmediatamente cualquier otro paquete de la misma cuadra
    for (let j = 0; j < nodes.length; j++) {
      if (!visited.has(j) && nodes[j].pkg.parsedAddress.blockKey === chosen.pkg.parsedAddress.blockKey) {
        visited.add(j);
        orderedNodes.push(nodes[j]);
      }
    }
  }

  // 2. Refinamiento local 2-opt para eliminar cruces innecesarios en la ruta
  let improved = true;
  let iterations = 0;
  while (improved && iterations < 40) {
    improved = false;
    iterations++;
    for (let i = 0; i < orderedNodes.length - 2; i++) {
      for (let k = i + 2; k < orderedNodes.length; k++) {
        // No separar paquetes que comparten la misma cuadra
        if (orderedNodes[i].pkg.parsedAddress.blockKey === orderedNodes[i + 1].pkg.parsedAddress.blockKey) {
          continue;
        }
        const prevPoint = i === 0 ? startCoords : orderedNodes[i - 1].coords;
        const a = orderedNodes[i].coords;
        const b = orderedNodes[k].coords;
        const nextPoint = k + 1 < orderedNodes.length ? orderedNodes[k + 1].coords : null;

        const currentCost =
          haversineDistanceKm(prevPoint, a) +
          (nextPoint ? haversineDistanceKm(b, nextPoint) : 0);
        const swappedCost =
          haversineDistanceKm(prevPoint, b) +
          (nextPoint ? haversineDistanceKm(a, nextPoint) : 0);

        if (swappedCost + 0.005 < currentCost) {
          // Invertir segmento [i..k]
          const reversed = orderedNodes.slice(i, k + 1).reverse();
          orderedNodes.splice(i, k - i + 1, ...reversed);
          improved = true;
        }
      }
    }
  }

  return [...orderedNodes.map((n) => ({ ...n.pkg, coordinates: n.coords })), ...completed];
}

/**
 * Persiste el nuevo orden de ruta en IndexedDB (Dexie).
 */
export async function persistRouteOrder(orderedPackages: DeliveryPackage[]): Promise<void> {
  await db.transaction('rw', db.packages, async () => {
    for (let idx = 0; idx < orderedPackages.length; idx++) {
      const pkg = orderedPackages[idx];
      if (pkg.id !== undefined) {
        await db.packages.update(pkg.id, {
          routeOrder: idx + 1,
          coordinates: pkg.coordinates || null
        });
      }
    }
  });
}
