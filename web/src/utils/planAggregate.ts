import type { PlanVersion, Assignment, Absence } from '../types';

/** Owner literal for deployment baseline + automatic quarterly snapshots. */
export const SYSTEM_OWNER = 'system';

/**
 * The newest version per non-system owner (the "current" state across all
 * PM plans). Employees see their assignments/absences aggregated over these
 * versions; system-owned baseline/snapshot versions are never part of the
 * aggregate. Versions arrive ordered by `createdAt ASC`, so the last
 * occurrence per owner wins ties deterministically.
 */
export function latestVersionPerOwner(versions: readonly PlanVersion[]): PlanVersion[] {
  const latestByOwner = new Map<string, PlanVersion>();
  for (const version of versions) {
    if (version.owner === SYSTEM_OWNER) continue;
    const current = latestByOwner.get(version.owner);
    if (current === undefined || version.createdAt >= current.createdAt) {
      latestByOwner.set(version.owner, version);
    }
  }
  return [...latestByOwner.values()];
}

/** Flattened assignments of the newest version of every non-system owner. */
export function currentPlanAssignments(versions: readonly PlanVersion[]): Assignment[] {
  return latestVersionPerOwner(versions).flatMap(version => version.assignments);
}

/** Flattened absences of the newest version of every non-system owner. */
export function currentPlanAbsences(versions: readonly PlanVersion[]): Absence[] {
  return latestVersionPerOwner(versions).flatMap(version => version.absences);
}

/** Whether `email` owns a plan (has at least one version). */
export function ownerHasPlan(versions: readonly PlanVersion[], email: string): boolean {
  return versions.some(version => version.owner === email && version.owner !== SYSTEM_OWNER);
}

/** Whether `version` is the newest version of its own owner. */
export function isLatestOfOwner(version: PlanVersion, versions: readonly PlanVersion[]): boolean {
  const latest = latestVersionPerOwner(versions).find(candidate => candidate.owner === version.owner);
  return latest !== undefined && latest.id === version.id;
}

/**
 * Whether the caller may edit `version`: owns it, it is the newest version
 * of that owner, and it is not a system-owned baseline/snapshot (those are
 * read-only for every user).
 */
export function canEditVersion(version: PlanVersion, email: string, versions: readonly PlanVersion[]): boolean {
  return version.owner !== SYSTEM_OWNER && version.owner === email && isLatestOfOwner(version, versions);
}
