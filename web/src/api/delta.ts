/**
 * Generic add/change/remove diffing for id-keyed collections.
 *
 * The backend's batch write RPCs (`ApplyAssignments`, `ApplyAbsences`) take a
 * delta - `{ upserts, deleteIds }` - rather than a whole rewritten array.
 * `computeDelta` bridges the gap for any collection of "things with an id"
 * (currently `Assignment[]` and `Absence[]`, but it makes no assumption
 * beyond `{ id: string }`).
 */

export interface Identified {
  id: string;
}

export interface Delta<T> {
  /** New or changed entries in `next` (by id), in `next`'s order. */
  upserts: T[];
  /** Ids present in `previous` but absent from `next`, in `previous`'s order. */
  deleteIds: string[];
}

/** Field-by-field comparison; both objects are expected to have identical key sets. */
function shallowEqual<T extends Identified>(a: T, b: T): boolean {
  const aKeys = Object.keys(a) as (keyof T)[];
  const bKeys = Object.keys(b) as (keyof T)[];
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(key => a[key] === b[key]);
}

/**
 * Diffs `previous` against `next` by id. An entry is an upsert when it is new
 * (no matching id in `previous`) or changed (matching id, different fields);
 * an id is a delete when it was in `previous` but is missing from `next`.
 * Identical arrays (by id and field values) produce an empty delta.
 */
export function computeDelta<T extends Identified>(previous: readonly T[], next: readonly T[]): Delta<T> {
  const previousById = new Map(previous.map(item => [item.id, item] as const));
  const nextIds = new Set(next.map(item => item.id));

  const upserts: T[] = [];
  for (const item of next) {
    const previousItem = previousById.get(item.id);
    if (previousItem === undefined || !shallowEqual(previousItem, item)) {
      upserts.push(item);
    }
  }

  const deleteIds: string[] = [];
  for (const item of previous) {
    if (!nextIds.has(item.id)) {
      deleteIds.push(item.id);
    }
  }

  return { upserts, deleteIds };
}
