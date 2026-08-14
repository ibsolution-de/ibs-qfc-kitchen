import type { Project, Assignment } from '../types';
import { parseBudget } from './money';

/**
 * Sum of all account budgets (display strings → numbers). 0 when no accounts.
 */
export function accountsBudget(project: Project): number {
  return (project.accounts ?? []).reduce(
    (sum, account) => sum + (parseBudget(account.budget) ?? 0),
    0
  );
}

/**
 * Effective budget for analysis: Σ account budgets, falling back to the
 * project's estimated budget string when the project has NO accounts.
 */
export function projectBudget(project: Project): number {
  const accounts = project.accounts ?? [];
  if (accounts.length === 0) return parseBudget(project.budget) ?? 0;
  return accountsBudget(project);
}

/** Sum of confirmed account budgets (status 'confirmed'). */
export function confirmedBudget(project: Project): number {
  return (project.accounts ?? [])
    .filter(account => account.status === 'confirmed')
    .reduce((sum, account) => sum + (parseBudget(account.budget) ?? 0), 0);
}

/** Sum of requested account budgets (status 'requested'). */
export function requestedBudget(project: Project): number {
  return (project.accounts ?? [])
    .filter(account => account.status === 'requested')
    .reduce((sum, account) => sum + (parseBudget(account.budget) ?? 0), 0);
}

/**
 * Planned (allocated) days on one account, across any plan state passed in.
 */
export function accountPlannedDays(assignments: readonly Assignment[], accountId: string): number {
  return assignments
    .filter(assignment => assignment.accountId === accountId)
    .reduce((sum, assignment) => sum + (assignment.allocation || 1), 0);
}

/**
 * Planned (allocated) days on a project: the union of its account-bound rows
 * (accounts are project-scoped and the backend enforces
 * `account.project_id == assignment.project_id`), legacy NULL-account rows,
 * and rows whose accountId is unknown/empty. Every row carrying the project's
 * id counts exactly once.
 */
export function projectPlannedDays(assignments: readonly Assignment[], projectId: string): number {
  return assignments
    .filter(assignment => assignment.projectId === projectId)
    .reduce((sum, assignment) => sum + (assignment.allocation || 1), 0);
}

/**
 * Cost of planned days: days * 8h * hourly rate (falls back to 100 like the
 * pre-existing financials code).
 */
export function plannedCost(plannedDays: number, hourlyRate: number | undefined): number {
  return plannedDays * 8 * (hourlyRate || 100);
}
