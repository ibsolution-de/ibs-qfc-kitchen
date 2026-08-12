import { describe, expect, it } from 'vitest';
import { compareBudgets, formatEuro, MARGIN_THRESHOLDS, parseBudget } from './money';

describe('parseBudget', () => {
  it.each([
    ['50k', 50000],
    ['50K', 50000],
    ['1.2m', 1_200_000],
    ['1,5m', 1_500_000],
    ['75000', 75000],
    ['250.000', 250000],
    ['€ 250.000', 250000],
    ['1.200.000', 1_200_000],
    ['1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    ['250,50', 250.5],
    ['250.50', 250.5],
    ['250k', 250000],
    ['1.5m', 1_500_000],
    ['€1.234,56', 1234.56],
  ])('parses %s as %s', (input, expected) => {
    expect(parseBudget(input)).toBe(expected);
  });

  it.each([
    ['TBD'],
    ['garbage'],
    [''],
    [undefined],
    [null],
  ])('returns null for %s', (input) => {
    expect(parseBudget(input as unknown as string)).toBeNull();
  });
});

describe('compareBudgets', () => {
  it('orders budgets by parsed numeric value', () => {
    const sorted = ['100k', '50k', '1.2m'].sort(compareBudgets);
    expect(sorted).toEqual(['50k', '100k', '1.2m']);
  });

  it('treats unparseable budgets as lower than any numeric budget', () => {
    const sorted = ['TBD', '50k', '100k'].sort(compareBudgets);
    expect(sorted).toEqual(['TBD', '50k', '100k']);
  });
});

describe('MARGIN_THRESHOLDS', () => {
  it('exposes risk and healthy thresholds', () => {
    expect(MARGIN_THRESHOLDS.risk).toBe(10);
    expect(MARGIN_THRESHOLDS.healthy).toBe(25);
  });
});

describe('formatEuro', () => {
  it('formats a large number with German grouping and the Euro symbol', () => {
    const formatted = formatEuro(1_234_567);
    expect(formatted).toContain('1.234.567');
    expect(formatted).toContain('€');
  });
});
