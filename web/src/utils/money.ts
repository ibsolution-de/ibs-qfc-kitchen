export const MARGIN_THRESHOLDS = { risk: 10, healthy: 25 } as const;

// Strips currency symbols and (non-breaking) spaces so `numericPart` is left
// with only digits, `.`, `,`, and a possible trailing k/m suffix.
function stripCurrencyAndSpaces(input: string): string {
  return input.replace(/[€$]/g, '').replace(/[\s ]/g, '');
}

// Disambiguates `.` vs `,` as the decimal separator in a single numeric
// string (German "1.234,56" / English "1,234.56" / thousands-only variants)
// and returns a string with a single `.` decimal separator and no thousands
// separators, ready for `Number()`.
function normalizeDecimalSeparator(numericPart: string): string {
  const hasDot = numericPart.includes('.');
  const hasComma = numericPart.includes(',');

  if (hasDot && hasComma) {
    const decimalChar = numericPart.lastIndexOf(',') > numericPart.lastIndexOf('.') ? ',' : '.';
    const thousandsChar = decimalChar === ',' ? '.' : ',';
    return numericPart
      .split(thousandsChar).join('')
      .replace(decimalChar, '.');
  }

  if (hasComma || hasDot) {
    const sep = hasComma ? ',' : '.';
    const occurrences = numericPart.split(sep).length - 1;
    const isDecimal = occurrences === 1 && /[,.]\d{1,2}$/.test(numericPart);
    if (isDecimal) {
      return numericPart.replace(sep, '.');
    }
    // Thousands separator(s) — strip all occurrences.
    return numericPart.split(sep).join('');
  }

  return numericPart;
}

export function parseBudget(input: string | null | undefined): number | null {
  if (input == null) return null;

  const trimmed = input.trim();
  if (trimmed === '') return null;

  const normalized = stripCurrencyAndSpaces(trimmed.toLowerCase());
  let multiplier = 1;
  let numericPart = normalized;

  if (normalized.endsWith('m')) {
    multiplier = 1_000_000;
    numericPart = normalized.slice(0, -1);
  } else if (normalized.endsWith('k')) {
    multiplier = 1_000;
    numericPart = normalized.slice(0, -1);
  }

  numericPart = numericPart.trim();
  if (numericPart === '') return null;

  const withDotDecimal = normalizeDecimalSeparator(numericPart);
  const parsed = Number(withDotDecimal);
  if (!Number.isFinite(parsed)) return null;

  const result = parsed * multiplier;
  return Number.isFinite(result) ? result : null;
}

export function compareBudgets(a: string | undefined, b: string | undefined): number {
  const valA = parseBudget(a) ?? -1;
  const valB = parseBudget(b) ?? -1;
  return valA - valB;
}

export function formatEuro(n: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(n);
}
