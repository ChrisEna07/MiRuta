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
import { estimateMedellinCoordinatesFromAddress } from './routeOptimizer';

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
      recipientPhone: '573004128890',
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
      scannedAt: now - (rawSamples.length - idx) * 60000
    };
    pkgBase.coordinates = estimateMedellinCoordinatesFromAddress(pkgBase);
    return pkgBase;
  });

  await db.packages.bulkAdd(toInsert);
}
