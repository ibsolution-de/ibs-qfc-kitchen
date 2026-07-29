import { describe, it, expect } from 'vitest';

import { hasPlanningAccess, getLandingRoute, type IsRole } from './access';
import type { UserRole } from '../types';

/** A fake `isRole` (set-intersection semantics, matching `AuthContext.isRole`) over a fixed role set. */
function isRoleOf(roles: UserRole[]): IsRole {
  return (role: UserRole | UserRole[]) => {
    const wanted = Array.isArray(role) ? role : [role];
    return wanted.some(r => roles.includes(r));
  };
}

describe('hasPlanningAccess', () => {
  it('is true for pm', () => {
    expect(hasPlanningAccess(isRoleOf(['pm']))).toBe(true);
  });

  it('is true for bl', () => {
    expect(hasPlanningAccess(isRoleOf(['bl']))).toBe(true);
  });

  it('is true for an employee who is also pm (dual role)', () => {
    expect(hasPlanningAccess(isRoleOf(['employee', 'pm']))).toBe(true);
  });

  it('is false for a plain employee', () => {
    expect(hasPlanningAccess(isRoleOf(['employee']))).toBe(false);
  });

  it('is false for sales-only', () => {
    expect(hasPlanningAccess(isRoleOf(['sales']))).toBe(false);
  });

  it('is false for admin-only', () => {
    expect(hasPlanningAccess(isRoleOf(['admin']))).toBe(false);
  });
});

describe('getLandingRoute', () => {
  it('sends pm/bl to the planner, even when also employee', () => {
    expect(getLandingRoute(isRoleOf(['pm']))).toBe('/planner');
    expect(getLandingRoute(isRoleOf(['bl']))).toBe('/planner');
    expect(getLandingRoute(isRoleOf(['employee', 'pm']))).toBe('/planner');
  });

  it('sends sales-only to the sales pipeline', () => {
    expect(getLandingRoute(isRoleOf(['sales']))).toBe('/sales-pipeline');
  });

  it('sends admin-only to the admin page', () => {
    expect(getLandingRoute(isRoleOf(['admin']))).toBe('/admin');
  });

  it('falls back to my-overview for a plain employee', () => {
    expect(getLandingRoute(isRoleOf(['employee']))).toBe('/my-overview');
  });

  it('prioritizes planning access over sales and admin when a user holds all three', () => {
    expect(getLandingRoute(isRoleOf(['pm', 'sales', 'admin']))).toBe('/planner');
  });

  it('prioritizes sales over admin when a user holds both but not planning access', () => {
    expect(getLandingRoute(isRoleOf(['sales', 'admin']))).toBe('/sales-pipeline');
  });
});
