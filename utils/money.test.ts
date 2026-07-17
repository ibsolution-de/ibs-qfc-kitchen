import { describe, expect, it } from 'vitest';
import { formatEuro, parseBudget } from './money';

describe('parseBudget', () => {
  it.each([
    ['50k', 50000],
    ['50K', 50000],
    ['1.2m', 1_200_000],
    ['1,5m', 1_500_000],
    ['75000', 75000],
  ])('parses %s as %s', (input, expected) => {
    expect(parseBudget(input)).toBe(expected);
  });

  it.each([
    ['TBD'],
    [''],
    [undefined],
    [null],
  ])('returns null for %s', (input) => {
    expect(parseBudget(input as unknown as string)).toBeNull();
  });
});

describe('formatEuro', () => {
  it('formats a large number with German grouping and the Euro symbol', () => {
    const formatted = formatEuro(1_234_567);
    expect(formatted).toContain('1.234.567');
    expect(formatted).toContain('€');
  });
});
