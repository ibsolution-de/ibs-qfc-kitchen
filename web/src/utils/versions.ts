import type { Assignment, Absence, PlanVersion } from '../types';

export interface AssignmentDiffEntry {
  key: string;
  type: 'added' | 'removed' | 'changed';
  employeeId: string;
  projectId: string;
  date: string;
  allocation: number;
  baseAllocation?: number;
  targetAllocation?: number;
}

export interface AbsenceDiffEntry {
  key: string;
  type: 'added' | 'removed';
  employeeId: string;
  date: string;
  absenceType: Absence['type'];
}

export interface VersionDiff {
  addedAssignments: number;
  removedAssignments: number;
  changedAssignments: number;
  addedAbsences: number;
  removedAbsences: number;
  assignmentEntries: AssignmentDiffEntry[];
  absenceEntries: AbsenceDiffEntry[];
}

const assignmentKey = (a: Pick<Assignment, 'employeeId' | 'projectId' | 'date'>): string =>
  `${a.employeeId}|${a.projectId}|${a.date}`;

const absenceKey = (a: Pick<Absence, 'employeeId' | 'date' | 'type'>): string =>
  `${a.employeeId}|${a.date}|${a.type}`;

const sortByKey = (a: { key: string }, b: { key: string }): number =>
  a.key.localeCompare(b.key);

export function diffVersions(a: PlanVersion, b: PlanVersion): VersionDiff {
  const baseAssignments = new Map<string, Assignment>();
  const targetAssignments = new Map<string, Assignment>();

  a.assignments.forEach((assignment) => {
    baseAssignments.set(assignmentKey(assignment), assignment);
  });
  b.assignments.forEach((assignment) => {
    targetAssignments.set(assignmentKey(assignment), assignment);
  });

  const assignmentEntries: AssignmentDiffEntry[] = [];

  baseAssignments.forEach((base, key) => {
    const target = targetAssignments.get(key);
    if (!target) {
      assignmentEntries.push({
        key,
        type: 'removed',
        employeeId: base.employeeId,
        projectId: base.projectId,
        date: base.date,
        allocation: base.allocation,
      });
    } else if (Math.abs(base.allocation - target.allocation) > 1e-9) {
      assignmentEntries.push({
        key,
        type: 'changed',
        employeeId: base.employeeId,
        projectId: base.projectId,
        date: base.date,
        allocation: target.allocation,
        baseAllocation: base.allocation,
        targetAllocation: target.allocation,
      });
    }
  });

  targetAssignments.forEach((target, key) => {
    if (!baseAssignments.has(key)) {
      assignmentEntries.push({
        key,
        type: 'added',
        employeeId: target.employeeId,
        projectId: target.projectId,
        date: target.date,
        allocation: target.allocation,
      });
    }
  });

  const baseAbsences = new Map<string, Absence>();
  const targetAbsences = new Map<string, Absence>();

  a.absences.forEach((absence) => {
    baseAbsences.set(absenceKey(absence), absence);
  });
  b.absences.forEach((absence) => {
    targetAbsences.set(absenceKey(absence), absence);
  });

  const absenceEntries: AbsenceDiffEntry[] = [];

  baseAbsences.forEach((base, key) => {
    if (!targetAbsences.has(key)) {
      absenceEntries.push({
        key,
        type: 'removed',
        employeeId: base.employeeId,
        date: base.date,
        absenceType: base.type,
      });
    }
  });

  targetAbsences.forEach((target, key) => {
    if (!baseAbsences.has(key)) {
      absenceEntries.push({
        key,
        type: 'added',
        employeeId: target.employeeId,
        date: target.date,
        absenceType: target.type,
      });
    }
  });

  assignmentEntries.sort(sortByKey);
  absenceEntries.sort(sortByKey);

  const addedAssignments = assignmentEntries.filter((e) => e.type === 'added').length;
  const removedAssignments = assignmentEntries.filter((e) => e.type === 'removed').length;
  const changedAssignments = assignmentEntries.filter((e) => e.type === 'changed').length;
  const addedAbsences = absenceEntries.filter((e) => e.type === 'added').length;
  const removedAbsences = absenceEntries.filter((e) => e.type === 'removed').length;

  return {
    addedAssignments,
    removedAssignments,
    changedAssignments,
    addedAbsences,
    removedAbsences,
    assignmentEntries,
    absenceEntries,
  };
}
