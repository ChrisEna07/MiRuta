import {
  type DeliveryPackage,
  getMaxMotorcycleCapacity,
  db
} from '../db/database';
import {
  estimateMedellinCoordinatesFromAddress,
  haversineDistanceKm,
  sortPackagesOfflineSnake,
  solveTSPNearestNeighbor2Opt,
  MEDELLIN_NORTH_EAST_CENTER
} from '../utils/routeOptimizer';

export interface BatchClusterGroup {
  batchNumber: number;
  label: string;
  packages: DeliveryPackage[];
  totalPackages: number;
  largePackagesCount: number;
  centerNeighborhood: string;
  hasIsolatedOutliers: boolean;
  isolatedCount: number;
}

export interface StagingAnalysisResult {
  batches: BatchClusterGroup[];
  isolatedPackages: DeliveryPackage[];
  totalPackages: number;
  totalBatches: number;
  maxMotorcycleCapacity: number;
}

/**
 * Distribuciónde Tandas en Moto (Batch Staging) con Enrutador Geográfico de Proximidad Estricta:
 * 1. Prioriza bultos grandes ('large') en la primera tanda y al inicio de la ruta para descargar la moto rápido.
 * 2. Agrupa por vecindad geográfica radial compacta (< 1.8km o 20 cuadras de radio) usando clustering de centroide iterativo.
 * 3. Identifica paquetes aislados (> 20 cuadras del núcleo del sector) con la bandera `isIsolatedOutlier: true`.
 * 4. Aplica barrido continuo en serpiente dentro de cada tanda individual.
 */
export function partitionPackagesIntoMotorcycleBatches(
  packages: DeliveryPackage[],
  maxCapacity: number = getMaxMotorcycleCapacity(),
  originCoords?: { lat: number; lng: number },
  outlierDistanceKm: number = 2.0 // ~20 cuadras en Medellín
): StagingAnalysisResult {
  const unarchived = packages.filter((p) => !p.archivedInHistory);
  const active = unarchived.filter((p) => p.status === 'pending' || p.status === 'in_progress');
  const finished = unarchived.filter((p) => p.status === 'delivered' || p.status === 'issue');

  if (active.length === 0) {
    return {
      batches: [],
      isolatedPackages: [],
      totalPackages: 0,
      totalBatches: 0,
      maxMotorcycleCapacity: maxCapacity,
    };
  }

  const startAnchor = originCoords || MEDELLIN_NORTH_EAST_CENTER;

  // Asignar coordenadas garantizadas
  const enriched = active.map((pkg) => ({
    ...pkg,
    coordinates: pkg.coordinates || estimateMedellinCoordinatesFromAddress(pkg)
  }));

  // Separar paquetes grandes/bultos pesados
  const largePackages = enriched.filter((p) => p.packageSize === 'large');
  const normalPackages = enriched.filter((p) => p.packageSize !== 'large');

  // Calcular centroide general del sector
  const avgLat = enriched.reduce((sum, p) => sum + (p.coordinates?.lat || startAnchor.lat), 0) / enriched.length;
  const avgLng = enriched.reduce((sum, p) => sum + (p.coordinates?.lng || startAnchor.lng), 0) / enriched.length;
  const centroid = { lat: avgLat, lng: avgLng };

  // Detectar paquetes aislados (> outlierDistanceKm del centroide del lote)
  const isolatedList: DeliveryPackage[] = [];
  const corePackages: DeliveryPackage[] = [];

  for (const p of normalPackages) {
    const dist = haversineDistanceKm(centroid, p.coordinates || centroid);
    if (dist > outlierDistanceKm) {
      isolatedList.push({ ...p, isIsolatedOutlier: true });
    } else {
      corePackages.push({ ...p, isIsolatedOutlier: false });
    }
  }

  // Ordenar pool priorizando cercanía al punto de partida GPS de la moto
  const normalSortedByOrigin = [...corePackages].sort((a, b) => {
    const da = haversineDistanceKm(startAnchor, a.coordinates || startAnchor);
    const db = haversineDistanceKm(startAnchor, b.coordinates || startAnchor);
    return da - db;
  });

  const remainingPool = [
    ...largePackages.map((p) => ({ ...p, isIsolatedOutlier: false })),
    ...normalSortedByOrigin,
    ...isolatedList
  ];
  const batches: BatchClusterGroup[] = [];
  let batchNum = 1;

  while (remainingPool.length > 0) {
    const currentBatchPkgs: DeliveryPackage[] = [];

    // Semilla del lote: El paquete más cercano al punto de partida o primer bulto
    const seed = remainingPool.shift()!;
    currentBatchPkgs.push(seed);

    // Llenar el lote con los paquetes más cercanos al núcleo de este lote
    while (currentBatchPkgs.length < maxCapacity && remainingPool.length > 0) {
      let bestIdx = -1;
      let minDistance = Infinity;

      // Calcular centroide actual de este lote
      const batchLat = currentBatchPkgs.reduce((s, p) => s + (p.coordinates?.lat || startAnchor.lat), 0) / currentBatchPkgs.length;
      const batchLng = currentBatchPkgs.reduce((s, p) => s + (p.coordinates?.lng || startAnchor.lng), 0) / currentBatchPkgs.length;
      const batchCenter = { lat: batchLat, lng: batchLng };

      for (let i = 0; i < remainingPool.length; i++) {
        const candidate = remainingPool[i];
        const dist = haversineDistanceKm(batchCenter, candidate.coordinates || batchCenter);
        // Si hay bultos grandes restantes, priorizarlos en la tanda 1
        const bonus = (batchNum === 1 && candidate.packageSize === 'large') ? -0.5 : 0;
        const score = dist + bonus;

        if (score < minDistance) {
          minDistance = score;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0) {
        currentBatchPkgs.push(remainingPool.splice(bestIdx, 1)[0]);
      } else {
        break;
      }
    }

    // Ordenar los paquetes de este lote usando TSP 2-Opt desde la posición GPS del motorizado
    const batchStartLocation = batchNum === 1 ? startAnchor : (currentBatchPkgs[0]?.coordinates || startAnchor);
    const tspSorted = solveTSPNearestNeighbor2Opt(currentBatchPkgs, batchStartLocation);

    // Priorizar que bultos grandes ('large') queden en las primeras paradas del lote
    const sortedBatch = [...tspSorted].sort((a, b) => {
      const aLarge = a.packageSize === 'large' ? 0 : 1;
      const bLarge = b.packageSize === 'large' ? 0 : 1;
      return aLarge - bLarge;
    });

    const labeledBatch: DeliveryPackage[] = sortedBatch.map((p, idx) => ({
      ...p,
      batchNumber: batchNum,
      routeOrder: idx + 1
    }));

    // Determinar barrio predominante
    const neighborhoodFreq: Record<string, number> = {};
    for (const p of labeledBatch) {
      const hood = p.parsedAddress?.neighborhood || 'Medellín';
      neighborhoodFreq[hood] = (neighborhoodFreq[hood] || 0) + 1;
    }
    const topHood = Object.entries(neighborhoodFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Sector Centro';

    const isolatedInBatch = labeledBatch.filter((p) => p.isIsolatedOutlier).length;

    batches.push({
      batchNumber: batchNum,
      label: `Tanda ${batchNum}: ${topHood} (${labeledBatch.length} paqs en moto)`,
      packages: labeledBatch,
      totalPackages: labeledBatch.length,
      largePackagesCount: labeledBatch.filter((p) => p.packageSize === 'large').length,
      centerNeighborhood: topHood,
      hasIsolatedOutliers: isolatedInBatch > 0,
      isolatedCount: isolatedInBatch
    });

    batchNum++;
  }

  return {
    batches,
    isolatedPackages: isolatedList,
    totalPackages: active.length,
    totalBatches: batches.length,
    maxMotorcycleCapacity: maxCapacity
  };
}

/**
 * Guarda las tandas calculadas en IndexedDB fijando `batchNumber` y `routeOrder`
 */
export async function persistMotorcycleBatches(
  batches: BatchClusterGroup[]
): Promise<void> {
  await db.transaction('rw', db.packages, async () => {
    let globalOrder = 1;
    for (const batch of batches) {
      for (const pkg of batch.packages) {
        if (pkg.id !== undefined) {
          await db.packages.update(pkg.id, {
            batchNumber: batch.batchNumber,
            routeOrder: globalOrder++,
            packageSize: pkg.packageSize || 'medium',
            isIsolatedOutlier: !!pkg.isIsolatedOutlier
          });
        }
      }
    }
  });
}
