import type { PersistedState, PersistenceProvider } from './types';

/** localStorage keys per entity (versioned, keep stable for user data continuity). */
export const STORAGE_KEYS: Record<keyof PersistedState, string> = {
  employees: 'ibs_qfc_employees_v3',
  projects: 'ibs_qfc_projects_v3',
  customers: 'ibs_qfc_customers_v3',
  versions: 'ibs_qfc_versions_v3',
};

export const localStorageProvider: PersistenceProvider = {
  load(key, fallback) {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS[key]);
      return saved ? (JSON.parse(saved) as PersistedState[typeof key]) : fallback;
    } catch (err) {
      console.warn(`Error loading state for ${key}`, err);
      return fallback;
    }
  },
  save(key, value) {
    try {
      localStorage.setItem(STORAGE_KEYS[key], JSON.stringify(value));
    } catch (err) {
      console.warn(`Error saving state for ${key}`, err);
    }
  },
};

/**
 * The active persistence provider for the whole app.
 * Swap this single binding to migrate the app to a real backend.
 */
export const persistence: PersistenceProvider = localStorageProvider;
