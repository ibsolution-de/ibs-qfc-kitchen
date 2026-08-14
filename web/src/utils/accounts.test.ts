import { describe, expect, it } from 'vitest';
import type { Account, Assignment, Project } from '../types';
import {
  accountsBudget,
  projectBudget,
  confirmedBudget,
  requestedBudget,
  accountPlannedDays,
  projectPlannedDays,
  plannedCost,
} from './accounts';

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'Alpha',
  client: 'Client A',
  color: 'blue',
  status: 'active',
  ...overrides,
});

const account = (id: string, overrides: Partial<Account> = {}): Account => ({
  id,
  projectId: 'p1',
  name: 'Account',
  status: 'confirmed',
  ...overrides,
});

const assignment = (id: string, overrides: Partial<Assignment> = {}): Assignment => ({
  id,
  employeeId: 'e1',
  projectId: 'p1',
  date: '2026-01-01',
  allocation: 1,
  ...overrides,
});

describe('accountsBudget', () => {
  it('sums mixed display strings via parseBudget', () => {
    const p = project({
      accounts: [
        account('a1', { budget: '50k' }),
        account('a2', { budget: '100000' }),
        account('a3', { budget: 'T&M' }), // unparseable → 0
      ],
    });
    expect(accountsBudget(p)).toBe(150_000);
  });

  it('returns 0 when the project has no accounts', () => {
    expect(accountsBudget(project({ budget: '80k' }))).toBe(0);
  });
});

describe('projectBudget', () => {
  it('falls back to the project estimated budget when there are no accounts', () => {
    expect(projectBudget(project({ budget: '80k' }))).toBe(80_000);
  });

  it('returns 0 for a project without accounts and an unparseable estimate', () => {
    expect(projectBudget(project({ budget: 'T&M' }))).toBe(0);
  });

  it('ignores the estimated budget when accounts exist', () => {
    const p = project({
      budget: '1m',
      accounts: [account('a1', { budget: '50k' }), account('a2', { budget: '50k' })],
    });
    expect(projectBudget(p)).toBe(100_000);
  });
});

describe('confirmedBudget / requestedBudget', () => {
  it('splits account budgets by status', () => {
    const p = project({
      accounts: [
        account('a1', { status: 'confirmed', budget: '50k' }),
        account('a2', { status: 'requested', budget: '30k' }),
        account('a3', { status: 'confirmed', budget: '20k' }),
        account('a4', { status: 'requested', budget: 'TBD' }), // unparseable → 0
      ],
    });
    expect(confirmedBudget(p)).toBe(70_000);
    expect(requestedBudget(p)).toBe(30_000);
  });

  it('returns 0 for a project without accounts', () => {
    expect(confirmedBudget(project())).toBe(0);
    expect(requestedBudget(project())).toBe(0);
  });
});

describe('accountPlannedDays', () => {
  it('sums allocations for the matching account only', () => {
    const assignments = [
      assignment('x1', { accountId: 'a1', allocation: 0.5 }),
      assignment('x2', { accountId: 'a1', allocation: 1 }),
      assignment('x3', { accountId: 'a2', allocation: 1 }),
      assignment('x4', { accountId: undefined, allocation: 3 }), // legacy row
    ];
    expect(accountPlannedDays(assignments, 'a1')).toBe(1.5);
    expect(accountPlannedDays(assignments, 'a2')).toBe(1);
    expect(accountPlannedDays(assignments, 'unknown')).toBe(0);
  });
});

describe('projectPlannedDays', () => {
  it('counts account-bound rows, legacy NULL-account rows and unknown-account rows once each', () => {
    const assignments = [
      assignment('x1', { accountId: 'a1', allocation: 0.5 }),
      assignment('x2', { accountId: undefined, allocation: 2 }), // legacy NULL
      assignment('x3', { accountId: '', allocation: 1 }), // unknown/empty
      assignment('x4', { accountId: 'ghost', allocation: 1 }), // unknown account
      assignment('x5', { projectId: 'other', allocation: 9 }), // other project
    ];
    expect(projectPlannedDays(assignments, 'p1')).toBe(4.5);
  });

  it('returns 0 when the project has no rows', () => {
    expect(projectPlannedDays([assignment('x1', { projectId: 'other' })], 'p1')).toBe(0);
  });
});

describe('plannedCost', () => {
  it('computes days * 8h * hourly rate', () => {
    expect(plannedCost(10, 150)).toBe(12_000);
  });

  it('falls back to a rate of 100 when the hourly rate is missing', () => {
    expect(plannedCost(10, undefined)).toBe(8_000);
  });
});
