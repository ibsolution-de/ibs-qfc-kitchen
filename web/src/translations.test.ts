import { describe, it, expect } from 'vitest';

import { translations } from './translations';

/**
 * Collects the dotted paths of every leaf (non-object) value in a
 * translation tree, e.g. `common.loading` - the exact strings `t()` is
 * called with.
 */
function collectKeyPaths(value: unknown, prefix: string, into: Set<string>): void {
  if (typeof value !== 'object' || value === null) {
    into.add(prefix);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    collectKeyPaths(child, prefix === '' ? key : `${prefix}.${key}`, into);
  }
}

describe('translations', () => {
  it('de and en expose identical key sets', () => {
    const enKeys = new Set<string>();
    collectKeyPaths(translations.en, '', enKeys);
    const deKeys = new Set<string>();
    collectKeyPaths(translations.de, '', deKeys);

    const missingInDe = [...enKeys].filter(key => !deKeys.has(key)).sort();
    const missingInEn = [...deKeys].filter(key => !enKeys.has(key)).sort();

    // Any drift means `t()` silently falls back to printing the raw key in
    // one language - list every offending path in the failure message.
    expect(
      { missingInDe, missingInEn },
      `key drift - missing in de: [${missingInDe.join(', ')}], missing in en: [${missingInEn.join(', ')}]`
    ).toEqual({ missingInDe: [], missingInEn: [] });
  });
});
