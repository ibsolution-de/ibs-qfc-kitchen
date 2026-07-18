import { describe, it, expect } from 'vitest';
import { diffVersions } from './versions';
import type { PlanVersion, Assignment, Absence } from '../types';

const baseVersion = (overrides: Partial<PlanVersion> = {}): PlanVersion => ({
  id: 'v1',
  name: 'Base',
  createdAt: '2024-01-01T00:00:00Z',
  assignments: [],
  absences: [],
  forecastData: [],
  ...overrides,
});

const assignment = (overrides: Partial<Assignment> = {}): Assignment => ({
  id: 'a1',
  employeeId: 'e1',
  projectId: 'p1',
  date: '2024-06-10',
  allocation: 1,
  ...overrides,
});

const absence = (overrides: Partial<Absence> = {}): Absence => ({
  id: 'abs1',
  employeeId: 'e1',
  date: '2024-06-10',
  type: 'vacation',
  approved: true,
  ...overrides,
});

describe('diffVersions', () => {
  it('returns an empty diff for identical versions', () => {
    const version = baseVersion({
      assignments: [assignment()],
      absences: [absence()],
    });
    const result = diffVersions(version, version);

    expect(result.addedAssignments).toBe(0);
    expect(result.removedAssignments).toBe(0);
    expect(result.changedAssignments).toBe(0);
    expect(result.addedAbsences).toBe(0);
    expect(result.removedAbsences).toBe(0);
    expect(result.assignmentEntries).toHaveLength(0);
    expect(result.absenceEntries).toHaveLength(0);
  });

  it('detects added assignments', () => {
    const base = baseVersion();
    const target = baseVersion({
      id: 'v2',
      assignments: [assignment()],
    });
    const result = diffVersions(base, target);

    expect(result.addedAssignments).toBe(1);
    expect(result.removedAssignments).toBe(0);
    expect(result.changedAssignments).toBe(0);
    expect(result.assignmentEntries).toHaveLength(1);
    expect(result.assignmentEntries[0]).toMatchObject({
      type: 'added',
      employeeId: 'e1',
      projectId: 'p1',
      date: '2024-06-10',
      allocation: 1,
    });
  });

  it('detects removed assignments', () => {
    const base = baseVersion({ assignments: [assignment()] });
    const target = baseVersion({ id: 'v2' });
    const result = diffVersions(base, target);

    expect(result.addedAssignments).toBe(0);
    expect(result.removedAssignments).toBe(1);
    expect(result.changedAssignments).toBe(0);
    expect(result.assignmentEntries[0]).toMatchObject({
      type: 'removed',
      employeeId: 'e1',
      projectId: 'p1',
      date: '2024-06-10',
      allocation: 1,
    });
  });

  it('detects changed assignments when allocation differs', () => {
    const base = baseVersion({ assignments: [assignment({ allocation: 0.5 })] });
    const target = baseVersion({
      id: 'v2',
      assignments: [assignment({ allocation: 1 })],
    });
    const result = diffVersions(base, target);

    expect(result.addedAssignments).toBe(0);
    expect(result.removedAssignments).toBe(0);
    expect(result.changedAssignments).toBe(1);
    const entry = result.assignmentEntries[0]!;
    expect(entry.type).toBe('changed');
    expect(entry.baseAllocation).toBe(0.5);
    expect(entry.targetAllocation).toBe(1);
  });

  it('detects added absences', () => {
    const base = baseVersion();
    const target = baseVersion({ id: 'v2', absences: [absence()] });
    const result = diffVersions(base, target);

    expect(result.addedAbsences).toBe(1);
    expect(result.removedAbsences).toBe(0);
    expect(result.absenceEntries[0]).toMatchObject({
      type: 'added',
      employeeId: 'e1',
      date: '2024-06-10',
      absenceType: 'vacation',
    });
  });

  it('detects removed absences', () => {
    const base = baseVersion({ absences: [absence()] });
    const target = baseVersion({ id: 'v2' });
    const result = diffVersions(base, target);

    expect(result.addedAbsences).toBe(0);
    expect(result.removedAbsences).toBe(1);
    expect(result.absenceEntries[0]).toMatchObject({
      type: 'removed',
      employeeId: 'e1',
      date: '2024-06-10',
      absenceType: 'vacation',
    });
  });
});
