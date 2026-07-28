import type { Customer, Employee, PlanVersion, Project } from '../../types';

/**
 * Aggregate of everything the app persists.
 * This shape intentionally mirrors the future backend API contract.
 */
export interface PersistedState {
  employees: Employee[];
  projects: Project[];
  customers: Customer[];
  versions: PlanVersion[];
}

/**
 * The single seam between the application and its data layer.
 *
 * Today the app is standalone: {@link localStorageProvider} implements this
 * interface against localStorage. The future split (see README.md in this
 * directory) swaps in an HTTP provider speaking protobuf over HTTP/3
 * (WebTransport where browsers support it) to a single-worker Rust + SQLite
 * backend — without touching application code.
 *
 * Contract notes for the future implementation:
 * - All entities are plain JSON-serializable objects (see `types.ts`), so the
 *   protobuf message definitions can map 1:1 to these shapes.
 * - `load` must be side-effect free and return `fallback` when no data exists.
 * - `save` is fire-and-forget from the app's perspective; a future provider
 *   may batch/debounce network writes behind this call.
 */
export interface PersistenceProvider {
  load<K extends keyof PersistedState>(key: K, fallback: PersistedState[K]): PersistedState[K];
  save<K extends keyof PersistedState>(key: K, value: PersistedState[K]): void;
}
