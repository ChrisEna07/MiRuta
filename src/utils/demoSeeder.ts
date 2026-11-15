import {
  db,
  type DeliveryPackage,
  getTodayShiftId,
  ensureShiftExists,
  extractLastFourDigits,
  normalizeColombianPhone,
  getDefaultPackageRate
} from '../db/database';
import { parseMedellinAddress } from './addressParser';
import {
  estimateMedellinCoordinatesFromAddress,
  sortPackagesOfflineSnake,
  persistRouteOrder
} from './routeOptimizer';

export async function seedMedellinDemoBatch(): Promise<void> {
  const shiftId = getTodayShiftId();
  await ensureShiftExists(shiftId);

  const existingCount = await db.packages.where('shiftId').equals(shiftId).count();
  if (existingCount > 0) return;

  const rate = getDefaultPackageRate();

  const rawSamples: Array<{
    trackingNumber: string;
    recipientName: string;
    recipientPhone: string;
    rawAddress: string;
    neighborhood: string;
  }> = [
    {
      trackingNumber: '6103026696672',
      recipientName: 'Alba Lucia Lopera Castrillon',
      recipientPhone: '573225873762',
      rawAddress: 'Carrera 43C # 100 - 52 Apto 301',
      neighborhood: 'El Poblado'
    },
    {
      trackingNumber: '6103026698104',
      recipientName: 'Carlos Andrés Restrepo Gómez',
      recipientPhone: '3116549021',
      rawAddress: 'Carrera 43C # 100 - 18 Edificio Bambú',
      neighborhood: 'El Poblado'
    },
    {
      trackingNumber: '6103026694519',
      recipientName: 'Valentina Montoya Salazar',
      recipientPhone: '573147892310',
      rawAddress: 'Carrera 44 # 101 - 24',
      neighborhood: 'El Poblado'
    },
    {
      trackingNumber: '6103026699231',
      recipientName: 'Juan Camilo Arango Ochoa',
      recipientPhone: '3018823412',
      rawAddress: 'Carrera 44 # 100 - 15 Local 2',
      neighborhood: 'El Poblado'
    },
    {
      trackingNumber: '6103026691188',
      recipientName: 'Diana Marcela Giraldo Pérez',
      recipientPhone: '573205194478',
      rawAddress: 'Carrera 45 # 100 - 40 Int 102',
      neighborhood: 'El Poblado'
    },
    {
      trackingNumber: '6103026697740',
      recipientName: 'Santiago Vélez Jaramillo',
      recipientPhone: '3159087712',
      rawAddress: 'Carrera 45 # 102 - 12',
      neighborhood: 'El Poblado'
    }
  ];

  const now = Date.now();
  const toInsert: DeliveryPackage[] = rawSamples.map((item, idx) => {
    const parsedAddress = parseMedellinAddress(item.rawAddress, item.neighborhood);
    const pkgBase: DeliveryPackage = {
      trackingNumber: item.trackingNumber,
      lastFourDigits: extractLastFourDigits(item.trackingNumber),
      recipientName: item.recipientName,
      recipientPhone: normalizeColombianPhone(item.recipientPhone),
      rawAddress: item.rawAddress,
      parsedAddress,
      coordinates: null,
      routeOrder: idx + 1,
      status: 'pending',
      issueNote: '',
      rate,
      shiftId,
      scannedAt: now - (rawSamples.length - idx) * 60000,
      archivedInHistory: false,
      isTestData: true
    };
    pkgBase.coordinates = estimateMedellinCoordinatesFromAddress(pkgBase);
    return pkgBase;
  });

  await db.packages.bulkAdd(toInsert);
}

export interface StressTestMetrics {
  insertedCount: number;
  insertTimeMs: number;
  snakeSortTimeMs: number;
  totalTimeMs: number;
}

/**
 * Simula un lote de 40 paquetes reales en un sector de Medellín (Laureles / Belén / El Poblado),
 * mide en milisegundos la inserción masiva en IndexedDB y el algoritmo de barrido en serpiente.
 */
export async function seedStressTest40Packages(): Promise<StressTestMetrics> {
  const t0 = performance.now();
  const shiftId = getTodayShiftId();
  const shift = await ensureShiftExists(shiftId);
  if (shift.status === 'closed') {
    await db.shifts.update(shiftId, { status: 'active', isPaused: false, endTime: null });
  }

  const rate = getDefaultPackageRate();
  const firstNames = [
    'Alba Lucia', 'Carlos Andrés', 'Valentina', 'Juan Camilo', 'Diana Marcela',
    'Santiago', 'María Fernanda', 'Sebastián', 'Natalia', 'Alejandro',
    'Luisa Fernanda', 'Mateo', 'Daniela', 'Jorge Iván', 'Carolina',
    'Andrés Felipe', 'Juliana', 'David', 'Paola Andrea', 'Cristian'
  ];
  const lastNames = [
    'Lopera Castrillon', 'Restrepo Gómez', 'Montoya Salazar', 'Arango Ochoa', 'Giraldo Pérez',
    'Vélez Jaramillo', 'Cano Botero', 'Ospina Mejía', 'Quintero Ríos', 'Uribe Escobar'
  ];
  const letters = ['', 'A', 'B', 'C'];
  const units = ['', 'Apto 201', 'Apto 302', 'Int 101', 'Local 1', 'Edificio Mirador', 'Casa 2'];

  const now = Date.now();
  const batch: DeliveryPackage[] = [];

  for (let i = 0; i < 40; i++) {
    const crNum = 43 + (i % 6); // Carreras 43 a 48
    const crLet = letters[i % letters.length];
    const clNum = 98 + Math.floor(i / 4); // Calles 98 a 107
    const plate = 10 + ((i * 7) % 80);
    const unit = units[i % units.length];
    const rawAddress = `Carrera ${crNum}${crLet} # ${clNum} - ${plate}${unit ? ` ${unit}` : ''}`;

    const trackingNumber =
      i === 0
        ? '6103026696672'
        : `610302${String(6691000 + i * 137).slice(-7)}`;

    const recipientName = `${firstNames[i % firstNames.length]} ${lastNames[i % lastNames.length]}`;
    const recipientPhone = normalizeColombianPhone(
      i === 0 ? '573225873762' : `3${10 + (i % 12)}${String(4567800 + i * 43).slice(-7)}`
    );

    const parsedAddress = parseMedellinAddress(rawAddress, 'El Poblado / Laureles');
    const pkg: DeliveryPackage = {
      trackingNumber,
      lastFourDigits: extractLastFourDigits(trackingNumber),
      recipientName,
      recipientPhone,
      rawAddress,
      parsedAddress,
      coordinates: null,
      routeOrder: i + 1,
      status: 'pending',
      issueNote: '',
      rate,
      shiftId,
      scannedAt: now - (40 - i) * 30000,
      archivedInHistory: false,
      isTestData: true
    };
    pkg.coordinates = estimateMedellinCoordinatesFromAddress(pkg);
    batch.push(pkg);
  }

  const tInsertStart = performance.now();
  await db.packages.bulkAdd(batch);
  const insertTimeMs = Number((performance.now() - tInsertStart).toFixed(2));

  // Ejecutar ordenamiento en serpiente y persistir
  const tSortStart = performance.now();
  const allToday = await db.packages.where('shiftId').equals(shiftId).toArray();
  const activeToday = allToday.filter((p) => !p.archivedInHistory);
  const sorted = sortPackagesOfflineSnake(activeToday, 'snake', 'CR');
  await persistRouteOrder(sorted);
  const snakeSortTimeMs = Number((performance.now() - tSortStart).toFixed(2));

  const totalTimeMs = Number((performance.now() - t0).toFixed(2));
  return {
    insertedCount: 40,
    insertTimeMs,
    snakeSortTimeMs,
    totalTimeMs
  };
}

/**
 * Limpia todos los paquetes de prueba (`isTestData === true`) sin afectar entregas reales.
 */
export async function clearStressTestPackages(): Promise<number> {
  const all = await db.packages.toArray();
  const testIds = all
    .filter((p) => p.isTestData && p.id !== undefined)
    .map((p) => p.id as number);
  if (testIds.length > 0) {
    await db.packages.bulkDelete(testIds);
  }
  return testIds.length;
}
