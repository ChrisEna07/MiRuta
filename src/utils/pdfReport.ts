import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { type DeliveryPackage, type DeductionRecord, getDefaultPackageRate } from '../db/database';
import { formatCOP } from './mediaAndFeedback';

export interface DailySummaryRow {
  date: string;
  deliveredCount: number;
  issueCount: number;
  unitRate: number;
  subtotal: number;
}

export interface QuincenaReportOptions {
  periodLabel: string;
  contractorName?: string;
  employerName?: string;
  packages: DeliveryPackage[];
  deductions?: DeductionRecord[];
}

/**
 * Genera el PDF formal de Cuenta de Cobro Quincenal para el Sr. Juan.
 * REGLA ESTRICTA DE PRIVACIDAD: JAMÁS incluye gastos de gasolina, horas trabajadas ni alertas del semáforo.
 * Solo incluye deducciones explícitamente marcadas con `applyToJuanPdf === true`.
 */
export async function generateAndShareQuincenaPDF(
  options: QuincenaReportOptions,
  mode: 'download' | 'share' = 'share'
): Promise<void> {
  const contractor = options.contractorName || 'Christian Romero';
  const employer = options.employerName || 'Sr. Juan';
  const defaultRate = getDefaultPackageRate();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const dayMap = new Map<string, { delivered: DeliveryPackage[]; issues: DeliveryPackage[] }>();

  for (const pkg of options.packages) {
    const dateKey = pkg.deliveredAt
      ? new Date(pkg.deliveredAt).toISOString().slice(0, 10)
      : pkg.shiftId || new Date(pkg.scannedAt).toISOString().slice(0, 10);

    if (!dayMap.has(dateKey)) {
      dayMap.set(dateKey, { delivered: [], issues: [] });
    }
    const group = dayMap.get(dateKey)!;
    if (pkg.status === 'delivered') {
      group.delivered.push(pkg);
    } else if (pkg.status === 'issue') {
      group.issues.push(pkg);
    }
  }

  const sortedDates = Array.from(dayMap.keys()).sort();
  const summaryRows: DailySummaryRow[] = [];
  let totalDelivered = 0;
  let totalIssues = 0;
  let grossTotalCOP = 0;

  for (const date of sortedDates) {
    const group = dayMap.get(date)!;
    const deliveredCount = group.delivered.length;
    const issueCount = group.issues.length;
    if (deliveredCount === 0 && issueCount === 0) continue;

    const subtotal = group.delivered.reduce((acc, p) => acc + (p.rate || defaultRate), 0);
    const avgDayRate = deliveredCount > 0 ? Math.round(subtotal / deliveredCount) : defaultRate;

    summaryRows.push({
      date,
      deliveredCount,
      issueCount,
      unitRate: avgDayRate,
      subtotal
    });

    totalDelivered += deliveredCount;
    totalIssues += issueCount;
    grossTotalCOP += subtotal;
  }

  const applicableDeductions = (options.deductions || []).filter((d) => d.applyToJuanPdf);
  const totalDeductionsCOP = applicableDeductions.reduce((acc, d) => acc + (d.amount || 0), 0);
  const netPayableCOP = Math.max(0, grossTotalCOP - totalDeductionsCOP);

  // --- ENCABEZADO EJECUTIVO ---
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 40, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.text('RELACIÓN QUINCENAL DE PAQUETES ENTREGADOS - OPERACIÓN IMILE', 10, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(148, 163, 184);
  doc.text(`Ciudad: Medellín, Antioquia  |  Fecha de Emisión: ${new Date().toLocaleDateString('es-CO')}`, 10, 22);
  doc.text(`Periodo Liquidado: ${options.periodLabel}`, 10, 28);
  doc.setTextColor(96, 165, 250);
  doc.setFont('helvetica', 'bold');
  doc.text('Generado por MiRuta by Christian Romero - Control Logístico y Liquidación Quincenal', 10, 35);

  // --- BLOQUE CONTRATISTA / CONTRATANTE ---
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(10, 45, 190, 24, 2, 2, 'F');

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(`CONTRATISTA: ${contractor}`, 15, 54);
  doc.text(`CONTRATANTE: ${employer}`, 15, 62);

  doc.text(`TARIFA BASE: ${formatCOP(defaultRate, true)} / Paquete`, 112, 54);
  doc.text(`TOTAL ENTREGAS EFECTIVAS: ${totalDelivered} paq.`, 112, 62);

  // --- TABLA 1: RESUMEN POR DÍA ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text('1. RESUMEN DE OPERACIÓN DIARIA', 10, 77);

  autoTable(doc, {
    startY: 81,
    margin: { left: 10, right: 10 },
    tableWidth: 'auto',
    styles: {
      fontSize: 8.5,
      cellPadding: 2,
      overflow: 'linebreak'
    },
    head: [
      [
        'Fecha',
        'Paquetes Entregados',
        'Novedades / Devueltos',
        'Tarifa Unitaria',
        'Subtotal Día ($ COP)'
      ]
    ],
    body:
      summaryRows.length > 0
        ? summaryRows.map((row) => [
            row.date,
            String(row.deliveredCount),
            String(row.issueCount),
            formatCOP(row.unitRate, true),
            formatCOP(row.subtotal, true)
          ])
        : [['Sin registros en el periodo', '0', '0', formatCOP(defaultRate, true), '$ 0 COP']],
    foot: [
      [
        'SUBTOTAL BRUTO ENTREGAS',
        String(totalDelivered),
        String(totalIssues),
        formatCOP(defaultRate, true),
        formatCOP(grossTotalCOP, true)
      ]
    ],
    theme: 'grid',
    headStyles: {
      fillColor: [30, 58, 138],
      textColor: 255,
      fontStyle: 'bold',
      halign: 'center'
    },
    bodyStyles: {
      textColor: [30, 41, 59],
      halign: 'center'
    },
    footStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center'
    },
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 36 },
      2: { cellWidth: 36 },
      3: { cellWidth: 38 },
      4: { cellWidth: 48 }
    }
  });

  let currentY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 140;

  // Si existen deducciones autorizadas para aparecer en el PDF del Sr. Juan
  if (applicableDeductions.length > 0) {
    currentY += 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(185, 28, 28);
    doc.text('DESCUENTOS / NOVEDADES APLICADAS EN LIQUIDACIÓN:', 10, currentY);

    autoTable(doc, {
      startY: currentY + 3,
      margin: { left: 10, right: 10 },
      tableWidth: 'auto',
      styles: {
        fontSize: 8.5,
        cellPadding: 2,
        overflow: 'linebreak'
      },
      head: [['Fecha', 'Concepto / Detalle', 'Guía Asociada', 'Valor Descuento']],
      body: applicableDeductions.map((d) => [
        d.date,
        `${d.title}${d.notes ? ` (${d.notes})` : ''}`,
        d.trackingNumber || 'N/A',
        `- ${formatCOP(d.amount, true)}`
      ]),
      theme: 'grid',
      headStyles: {
        fillColor: [153, 27, 27],
        textColor: 255,
        fontStyle: 'bold'
      },
      columnStyles: {
        0: { cellWidth: 28, halign: 'center' },
        1: { cellWidth: 90 },
        2: { cellWidth: 34, halign: 'center' },
        3: { cellWidth: 38, halign: 'right' }
      }
    });

    currentY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || currentY + 25;
  }

  // --- CAJA GRAN TOTAL A PAGAR ---
  const boxY = Math.min(currentY + 8, 242);
  doc.setFillColor(22, 163, 74);
  doc.roundedRect(10, boxY, 190, 22, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.text('GRAN TOTAL NETO A PAGAR:', 16, boxY + 13.5);
  doc.setFontSize(14.5);
  doc.text(formatCOP(netPayableCOP, true), 194, boxY + 13.5, { align: 'right' });

  // Firma y pie de página en página 1
  if (boxY + 36 < 285) {
    doc.setDrawColor(148, 163, 184);
    doc.line(10, boxY + 33, 90, boxY + 33);
    doc.setTextColor(71, 85, 105);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.text(`Firma: ${contractor} - Operador Logístico Última Milla`, 10, boxY + 38);
  }
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.text(
    'Generado por MiRuta by Christian Romero - Control Logístico y Liquidación Quincenal',
    105,
    290,
    { align: 'center' }
  );

  // --- SEGUNDA PÁGINA: ANEXO VERIFICABLE DE GUÍAS ENTREGADAS ---
  const deliveredPackages = options.packages
    .filter((p) => p.status === 'delivered')
    .sort((a, b) => (a.deliveredAt || a.scannedAt) - (b.deliveredAt || b.scannedAt));

  doc.addPage();
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text('2. ANEXO VERIFICABLE DE GUÍAS ENTREGADAS (SOPORTE DETALLADO)', 10, 15);

  autoTable(doc, {
    startY: 29,
    margin: { left: 10, right: 10 },
    tableWidth: 'auto',
    styles: {
      fontSize: 8.5,
      cellPadding: 2,
      overflow: 'linebreak'
    },
    head: [['#', 'Guía iMile Completa', 'Últ. 4', 'Dirección de Entrega (Medellín)', 'Fecha y Hora Exacta']],
    body:
      deliveredPackages.length > 0
        ? deliveredPackages.map((pkg, idx) => {
            const ts = pkg.deliveredAt || pkg.scannedAt;
            const dateStr = new Date(ts).toLocaleString('es-CO', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            });
            return [
              String(idx + 1),
              pkg.trackingNumber,
              pkg.lastFourDigits,
              pkg.rawAddress,
              dateStr
            ];
          })
        : [['-', 'Sin guías entregadas en el rango seleccionado', '-', '-', '-']],
    theme: 'striped',
    headStyles: {
      fillColor: [30, 58, 138],
      textColor: 255,
      fontSize: 8.5,
      fontStyle: 'bold'
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [30, 41, 59]
    },
    // Suma exacta: 10 + 42 + 16 + 80 + 42 = 190mm (cabe 100% en A4 con márgenes izq/der de 10mm)
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 42, fontStyle: 'bold' },
      2: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 80 },
      4: { cellWidth: 42, halign: 'center' }
    }
  });

  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.text(
    'Generado por MiRuta by Christian Romero - Control Logístico y Liquidación Quincenal',
    105,
    290,
    { align: 'center' }
  );

  const cleanFileName = `MiRuta_Cuenta_Cobro_${contractor.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;

  if (mode === 'share' && typeof navigator !== 'undefined' && navigator.share) {
    try {
      const pdfBlob = doc.output('blob');
      const pdfFile = new File([pdfBlob], cleanFileName, { type: 'application/pdf' });
      if (!navigator.canShare || navigator.canShare({ files: [pdfFile] })) {
        await navigator.share({
          title: 'MiRuta by Christian Romero - Cuenta de Cobro Quincenal',
          text: `Hola ${employer}, adjunto la relación quincenal verificable generada en MiRuta (${totalDelivered} entregas = ${formatCOP(netPayableCOP, true)}).`,
          files: [pdfFile]
        });
        return;
      }
    } catch {
      // Si el usuario cancela o el navegador no soporta compartir archivos, descargamos directamente
    }
  }

  doc.save(cleanFileName);
}
