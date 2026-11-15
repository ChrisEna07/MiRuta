/**
 * Formatea un string numérico en vivo con separador de miles colombiano (ej. "120000" -> "120.000")
 * impidiendo valores negativos o NaN.
 */
export function formatLiveCOPInput(raw: string | number): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  const num = parseInt(digits, 10);
  if (isNaN(num) || num < 0) return '';
  return new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 0
  }).format(num);
}

/**
 * Convierte un string formateado con puntos ("120.000") a número entero positivo (120000).
 */
export function parseLiveCOPInput(formatted: string | number): number {
  const digits = String(formatted ?? '').replace(/\D/g, '');
  if (!digits) return 0;
  const num = parseInt(digits, 10);
  return isNaN(num) || num < 0 ? 0 : num;
}

export interface PhoneValidationResult {
  formatted: string;
  normalized: string;
  digitsCount: number;
  missingDigits: number;
  isValid: boolean;
  helperText: string;
}

/**
 * Formatea en vivo un número celular colombiano (ej. "322 587 3762" o "+57 322 587 3762")
 * y evalúa cuántos dígitos faltan para WhatsApp.
 */
export function validateAndFormatColombianPhone(raw: string): PhoneValidationResult {
  const rawDigits = (raw || '').replace(/\D/g, '');
  if (!rawDigits) {
    return {
      formatted: '',
      normalized: '',
      digitsCount: 0,
      missingDigits: 10,
      isValid: false,
      helperText: 'Opcional: Ingresa los 10 dígitos del celular (ej. 322 587 3762)'
    };
  }

  // Si empieza por 573..., extraer los 10 dígitos nacionales desde el 3
  let nationalDigits = rawDigits;
  if (rawDigits.startsWith('57') && rawDigits.length > 2) {
    nationalDigits = rawDigits.slice(2, 12);
  } else {
    nationalDigits = rawDigits.slice(0, 10);
  }

  // Formatear visualmente como "322 587 3762"
  let formatted = nationalDigits;
  if (nationalDigits.length > 3 && nationalDigits.length <= 6) {
    formatted = `${nationalDigits.slice(0, 3)} ${nationalDigits.slice(3)}`;
  } else if (nationalDigits.length > 6) {
    formatted = `${nationalDigits.slice(0, 3)} ${nationalDigits.slice(3, 6)} ${nationalDigits.slice(6, 10)}`;
  }

  const len = nationalDigits.length;
  const startsWithThree = nationalDigits.startsWith('3');
  const missingDigits = Math.max(0, 10 - len);
  const isValid = len === 10 && startsWithThree;

  let helperText = '';
  if (!startsWithThree) {
    helperText = '⚠️ El celular colombiano debe iniciar por 3 (ej. 300, 310, 322)';
  } else if (missingDigits > 0) {
    helperText = `⚠️ Faltan ${missingDigits} ${missingDigits === 1 ? 'dígito' : 'dígitos'} para poder abrir WhatsApp`;
  } else {
    helperText = `✅ Celular WhatsApp listo (+57 ${formatted})`;
  }

  return {
    formatted,
    normalized: isValid ? `57${nationalDigits}` : nationalDigits,
    digitsCount: len,
    missingDigits,
    isValid,
    helperText
  };
}

/**
 * Sanitiza un código de guía iMile permitiendo únicamente caracteres alfanuméricos sin espacios.
 */
export function sanitizeTrackingInput(raw: string): string {
  return (raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}
