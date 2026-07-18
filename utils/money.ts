export const MARGIN_THRESHOLDS = { risk: 10, healthy: 25 } as const;

export function parseBudget(input: string | null | undefined): number | null {
  if (input == null) return null;

  const trimmed = input.trim();
  if (trimmed === '') return null;

  const normalized = trimmed.toLowerCase();
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

  const withDotDecimal = numericPart.replace(',', '.');
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
