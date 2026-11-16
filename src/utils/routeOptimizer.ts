import { type DeliveryPackage, db } from '../db/database';
import { parseMedellinAddress } from './addressParser';

export type SweepDirection = 'asc' | 'desc' | 'snake';
export type RoutingStrategy = 'nearest_first' | 'furthest_first' | 'snake_neighborhood';

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
 * Centro geográfico de referencia en Medellín Nororiental (Comuna 2 Santa Cruz / Comuna 4 Aranjuez).
 * Evita saltos de río al Puente Madre Laura hacia Castilla o Robledo.
 */
export const MEDELLIN_NORTH_EAST_CENTER = { lat: 6.2885, lng: -75.5580 };

/**
 * Captura la posición GPS real actual del dispositivo (Moto) con límite de 2.8s
 * y cae a Medellín Nororiental (Aranjuez/Santa Cruz) si no hay señal.
 */
export function getCurrentMotorcycleGPS(timeoutMs = 2800): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(MEDELLIN_NORTH_EAST_CENTER);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6))
        });
      },
      () => {
        resolve(MEDELLIN_NORTH_EAST_CENTER);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
    );
  });
}

/**
 * Aproximación de coordenadas en el Valle de Aburrá (Medellín) basada en nomenclatura Calle/Carrera
 * cuando un paquete aún no tiene coordenadas GPS o Nominatim no encuentra una placa específica.
 * Blindado para zona Nororiental (Comunas 2 y 4): previene saltar al oeste del Río Medellín.
 */
export function estimateMedellinCoordinatesFromAddress(pkg: DeliveryPackage): { lat: number; lng: number } {
  if (pkg.coordinates && pkg.coordinates.lat && pkg.coordinates.lng) {
    return pkg.coordinates;
  }
  const grid = getGridCoordinates(pkg);
  
  // En Medellín Nororiental:
  // Base referencia Calle 1: Lat 6.2115, Lng -75.5320
  const baseLat = 6.2115;
  const baseLng = -75.5320;
  const calleVal = grid.calleAxis || 90;
  const carreraVal = grid.carreraAxis || 45;
  const plateOffset = (grid.plate || 20) / 100;

  const estimatedLat = Number((baseLat + (calleVal + plateOffset * 0.5) * 0.00075).toFixed(6));
  // Limitar longitud para no cruzar el Río Medellín (-75.5630 es la ribera este a la altura de Aranjuez/Madre Laura)
  const rawLng = baseLng - (carreraVal + plateOffset * 0.5) * 0.00075;
  const estimatedLng = Number(Math.max(-75.5628, rawLng).toFixed(6));

  return {
    lat: estimatedLat,
    lng: estimatedLng
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

function applyTwoOptRefinement(
  orderedNodes: Array<{ pkg: DeliveryPackage; coords: { lat: number; lng: number } }>,
  startCoords: { lat: number; lng: number }
) {
  let improved = true;
  let iterations = 0;
  while (improved && iterations < 35) {
    improved = false;
    iterations++;
    for (let i = 0; i < orderedNodes.length - 2; i++) {
      for (let k = i + 2; k < orderedNodes.length; k++) {
        if (orderedNodes[i].pkg.parsedAddress?.blockKey === orderedNodes[i + 1].pkg.parsedAddress?.blockKey) {
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
          const reversed = orderedNodes.slice(i, k + 1).reverse();
          orderedNodes.splice(i, k - i + 1, ...reversed);
          improved = true;
        }
      }
    }
  }
}

/**
 * Enrutamiento Pre-Condicionado v10.0:
 * NODO 0 Obligatorio = Ubicación GPS actual de la moto (lat/lng exactas de Christian).
 * Aplica 3 estrategias manuales seleccionadas por el repartidor.
 */
export function optimizeRouteWithStrategy(
  packages: DeliveryPackage[],
  userGPS: { lat: number; lng: number },
  strategy: RoutingStrategy
): DeliveryPackage[] {
  const active = packages.filter((p) => p.status === 'pending' || p.status === 'in_progress');
  const completed = packages.filter((p) => p.status !== 'pending' && p.status !== 'in_progress');

  if (active.length <= 1) {
    return [...active, ...completed];
  }

  // Asegurar coordenadas estimadas/reales
  const nodes = active.map((pkg) => ({
    pkg,
    coords: pkg.coordinates || estimateMedellinCoordinatesFromAddress(pkg)
  }));

  const orderedNodes: typeof nodes = [];

  if (strategy === 'nearest_first') {
    // 🚀 De más cerca a más lejos: NODO 0 = userGPS. Voraz hacia afuera + 2-opt
    const visited = new Set<number>();
    let currentPos = userGPS;

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

      // Mantener paquetes de la misma cuadra pegados
      for (let j = 0; j < nodes.length; j++) {
        if (!visited.has(j) && nodes[j].pkg.parsedAddress?.blockKey === chosen.pkg.parsedAddress?.blockKey) {
          visited.add(j);
          orderedNodes.push(nodes[j]);
        }
      }
    }

    applyTwoOptRefinement(orderedNodes, userGPS);

  } else if (strategy === 'furthest_first') {
    // 🔄 De más lejos a más cerca:
    // NODO 0 = userGPS. Parada 1 es el paquete más alejado de la posición actual del usuario.
    // Desde allá, el algoritmo avanza regresando hacia el NODO 0.
    const visited = new Set<number>();

    // 1. Encontrar el nodo más lejano respecto al GPS del usuario
    let furthestIdx = -1;
    let maxDistFromGPS = -1;
    for (let i = 0; i < nodes.length; i++) {
      const d = haversineDistanceKm(userGPS, nodes[i].coords);
      if (d > maxDistFromGPS) {
        maxDistFromGPS = d;
        furthestIdx = i;
      }
    }

    if (furthestIdx !== -1) {
      visited.add(furthestIdx);
      const startNode = nodes[furthestIdx];
      orderedNodes.push(startNode);
      let currentPos = startNode.coords;

      // Misma cuadra que el primer nodo
      for (let j = 0; j < nodes.length; j++) {
        if (!visited.has(j) && nodes[j].pkg.parsedAddress?.blockKey === startNode.pkg.parsedAddress?.blockKey) {
          visited.add(j);
          orderedNodes.push(nodes[j]);
        }
      }

      // 2. Desde el punto más distante, avanzar hacia los vecinos priorizando regresar hacia userGPS
      while (orderedNodes.length < nodes.length) {
        let bestIdx = -1;
        let bestScore = Infinity;

        for (let i = 0; i < nodes.length; i++) {
          if (visited.has(i)) continue;
          const distFromCurrent = haversineDistanceKm(currentPos, nodes[i].coords);
          const distToUserGPS = haversineDistanceKm(nodes[i].coords, userGPS);
          // Minimizamos distancia local al siguiente punto con sesgo de retorno al punto de inicio
          const score = distFromCurrent * 0.75 + distToUserGPS * 0.25;
          if (score < bestScore) {
            bestScore = score;
            bestIdx = i;
          }
        }

        if (bestIdx === -1) break;
        visited.add(bestIdx);
        const chosen = nodes[bestIdx];
        orderedNodes.push(chosen);
        currentPos = chosen.coords;

        // Misma cuadra pegados
        for (let j = 0; j < nodes.length; j++) {
          if (!visited.has(j) && nodes[j].pkg.parsedAddress?.blockKey === chosen.pkg.parsedAddress?.blockKey) {
            visited.add(j);
            orderedNodes.push(nodes[j]);
          }
        }
      }
    }

  } else {
    // 🐍 Serpiente / Vecindario:
    // Agrupación estricta por cuadras / nomenclatura partiendo desde la cuadra más cercana a userGPS
    const blockGroups = new Map<string, typeof nodes>();
    for (const node of nodes) {
      const bKey = node.pkg.parsedAddress?.blockKey || `single_${node.pkg.id ?? Math.random()}`;
      if (!blockGroups.has(bKey)) {
        blockGroups.set(bKey, []);
      }
      blockGroups.get(bKey)!.push(node);
    }

    // Ordenar paquetes dentro de cada cuadra por placa numérica
    for (const group of blockGroups.values()) {
      group.sort((a, b) => (a.pkg.parsedAddress?.plate || 0) - (b.pkg.parsedAddress?.plate || 0));
    }

    // Ordenar los bloques: empezando por el bloque más cercano a userGPS
    const blockKeys = Array.from(blockGroups.keys());
    const visitedBlocks = new Set<string>();
    let currentBlockPos = userGPS;

    while (visitedBlocks.size < blockKeys.length) {
      let bestBlockKey = '';
      let bestDist = Infinity;

      for (const bKey of blockKeys) {
        if (visitedBlocks.has(bKey)) continue;
        const bNodes = blockGroups.get(bKey)!;
        const center = bNodes[0].coords;
        const d = haversineDistanceKm(currentBlockPos, center);
        if (d < bestDist) {
          bestDist = d;
          bestBlockKey = bKey;
        }
      }

      if (!bestBlockKey) break;
      visitedBlocks.add(bestBlockKey);
      const chosenNodes = blockGroups.get(bestBlockKey)!;
      orderedNodes.push(...chosenNodes);
      currentBlockPos = chosenNodes[chosenNodes.length - 1].coords;
    }
  }

  // Devolver paquetes ordenados con número de parada actualizado
  return [
    ...orderedNodes.map((n, idx) => ({
      ...n.pkg,
      coordinates: n.coords,
      routeOrder: idx + 1
    })),
    ...completed
  ];
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
