import type { UserRole } from '../types';

/** Matches `AuthContext.isRole`'s signature without importing the context (keeps this pure/testable). */
export type IsRole = (role: UserRole | UserRole[]) => boolean;

/**
 * Whether the caller has planning-staff access (forecast/team/financials/
 * strategy edit rights, a writable planner, and version history visibility).
 * `employee` is no longer mutually exclusive with `pm`/`bl`, so this is the
 * one place that decides "planning staff" - `App.tsx` (planner read-only) and
 * `Sidebar.tsx` (version history section) both call it so the two can never
 * drift apart on who counts.
 */
export function hasPlanningAccess(isRole: IsRole): boolean {
  return isRole(['pm', 'bl']);
}

export type LandingRoute = '/planner' | '/sales-pipeline' | '/admin' | '/my-overview';

/**
 * The default route a signed-in user lands on. Roles are a set, not mutually
 * exclusive, so this is an explicit priority order rather than a chain of
 * independent booleans: planning access first (pm/bl need their planner),
 * then sales, then admin, and `my-overview` as the fallback every user has.
 */
export function getLandingRoute(isRole: IsRole): LandingRoute {
  if (hasPlanningAccess(isRole)) return '/planner';
  if (isRole('sales')) return '/sales-pipeline';
  if (isRole('admin')) return '/admin';
  return '/my-overview';
}
