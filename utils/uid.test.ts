import { describe, it, expect } from 'vitest';
import { uid } from './uid';

describe('uid', () => {
  it('returns a string', () => {
    const id = uid();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('produces unique ids across 1000 calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(uid());
    }
    expect(ids.size).toBe(1000);
  });

  it('matches UUID v4 shape', () => {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (let i = 0; i < 100; i++) {
      expect(uid()).toMatch(uuidPattern);
    }
  });
});
