import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localStorageProvider, STORAGE_KEYS } from './localStorageProvider';

/**
 * Hermetic in-memory localStorage stub.
 * Kept environment-independent on purpose: jsdom under Node 26 is flaky in
 * this setup (Node's experimental built-in localStorage interferes with
 * vitest's jsdom global injection), so this suite stubs the global directly.
 */
function createLocalStorageStub() {
  let store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } satisfies Storage;
}

const stub = createLocalStorageStub();

beforeEach(() => {
  vi.stubGlobal('localStorage', stub);
  stub.clear();
});

describe('localStorageProvider', () => {
  it('returns the fallback when nothing is stored', () => {
    expect(localStorageProvider.load('employees', [])).toEqual([]);
    expect(localStorageProvider.load('versions', [{ id: 'v1' } as never])).toEqual([{ id: 'v1' }]);
  });

  it('round-trips entities through localStorage', () => {
    const employees = [{ id: 'e1', name: 'Ada' }];
    localStorageProvider.save('employees', employees as never);
    expect(stub.getItem(STORAGE_KEYS.employees)).toBe(JSON.stringify(employees));
    expect(localStorageProvider.load('employees', [])).toEqual(employees);
  });

  it('falls back on corrupted JSON and warns', () => {
    stub.setItem(STORAGE_KEYS.projects, '{not json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(localStorageProvider.load('projects', [{ id: 'p1' } as never])).toEqual([{ id: 'p1' }]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('maps every entity to its versioned storage key', () => {
    expect(STORAGE_KEYS).toEqual({
      employees: 'ibs_qfc_employees_v3',
      projects: 'ibs_qfc_projects_v3',
      customers: 'ibs_qfc_customers_v3',
      versions: 'ibs_qfc_versions_v3',
    });
  });

  it('does not throw when saving fails (quota)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('localStorage', {
      ...stub,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    });
    expect(() => localStorageProvider.save('customers', [])).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
