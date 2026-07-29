import { describe, it, expect } from 'vitest';

import { computeDelta } from './delta';
import type { Assignment, Absence } from '../types';

const assignment = (overrides: Partial<Assignment> = {}): Assignment => ({
  id: 'a1',
  employeeId: 'e1',
  projectId: 'p1',
  date: '2024-01-01',
  allocation: 1,
  ...overrides,
});

describe('computeDelta', () => {
  it('produces an empty delta for identical arrays', () => {
    const previous = [assignment(), assignment({ id: 'a2' })];
    const next = [assignment(), assignment({ id: 'a2' })];

    expect(computeDelta(previous, next)).toEqual({ upserts: [], deleteIds: [] });
  });

  it('produces an empty delta for two empty arrays', () => {
    expect(computeDelta<Assignment>([], [])).toEqual({ upserts: [], deleteIds: [] });
  });

  it('reports a brand new entry as an upsert', () => {
    const previous = [assignment()];
    const added = assignment({ id: 'a2', date: '2024-01-02' });
    const next = [assignment(), added];

    expect(computeDelta(previous, next)).toEqual({ upserts: [added], deleteIds: [] });
  });

  it('reports a changed field on an existing id as an upsert', () => {
    const previous = [assignment({ allocation: 0.5 })];
    const changed = assignment({ allocation: 1 });
    const next = [changed];

    expect(computeDelta(previous, next)).toEqual({ upserts: [changed], deleteIds: [] });
  });

  it('reports an id missing from next as a delete', () => {
    const previous = [assignment(), assignment({ id: 'a2' })];
    const next = [assignment()];

    expect(computeDelta(previous, next)).toEqual({ upserts: [], deleteIds: ['a2'] });
  });

  it('handles a mix of add, change, remove and unchanged entries in one call', () => {
    const unchanged = assignment({ id: 'a1' });
    const toChange = assignment({ id: 'a2', allocation: 0.5 });
    const toRemove = assignment({ id: 'a3' });
    const changed = { ...toChange, allocation: 1 };
    const added = assignment({ id: 'a4' });

    const previous = [unchanged, toChange, toRemove];
    const next = [unchanged, changed, added];

    expect(computeDelta(previous, next)).toEqual({
      upserts: [changed, added],
      deleteIds: ['a3'],
    });
  });

  it('is generic over any id-keyed shape, e.g. Absence', () => {
    const absence = (overrides: Partial<Absence> = {}): Absence => ({
      id: 'b1',
      employeeId: 'e1',
      date: '2024-01-01',
      type: 'vacation',
      approved: false,
      ...overrides,
    });

    const previous = [absence()];
    const next = [absence({ approved: true })];

    expect(computeDelta(previous, next)).toEqual({ upserts: [next[0]], deleteIds: [] });
  });
});
