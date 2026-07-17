import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isWeekend,
  startOfMonth,
} from 'date-fns';
import type { Absence, Assignment, Employee } from '../types';

export interface DraftAssignment {
  projectId: string;
  allocation: number;
  assignmentId?: string;
}

export interface DraftAbsence {
  type: Absence['type'];
  approved?: boolean;
}

export interface ComputeTargetDatesOptions {
  baseDate: Date;
  mode: 'project' | 'absence';
  isRepeat?: boolean;
  repeatDays?: number[];
  absenceDuration?: number;
}

/**
 * Computes the ISO date strings that should be affected by a save operation.
 *
 * - Project mode without repeat: returns the base date only.
 * - Project mode with repeat: returns every day in the base date's month that
 *   matches one of the selected `repeatDays` (0 = Sunday, 1 = Monday, …).
 * - Absence mode: returns the next `absenceDuration` working days (skipping
 *   weekends) starting from the base date.
 */
export function computeTargetDates(options: ComputeTargetDatesOptions): string[] {
  const { baseDate, mode, isRepeat, repeatDays = [], absenceDuration = 1 } = options;

  if (mode === 'project') {
    if (isRepeat) {
      const monthStart = startOfMonth(baseDate);
      const monthEnd = endOfMonth(baseDate);
      const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
      return daysInMonth
        .filter((d) => repeatDays.includes(getDay(d)))
        .map((d) => format(d, 'yyyy-MM-dd'));
    }
    return [format(baseDate, 'yyyy-MM-dd')];
  }

  // Absence mode: consecutive working days (skip weekends)
  const dates: string[] = [];
  let count = 0;
  let offset = 0;
  while (count < absenceDuration) {
    const d = addDays(baseDate, offset);
    if (!isWeekend(d)) {
      dates.push(format(d, 'yyyy-MM-dd'));
      count++;
    }
    offset++;
  }
  return dates;
}

export interface MergeDayEntriesInput {
  /** Existing assignments in the plan. */
  assignments: Assignment[];
  /** Existing absences in the plan. */
  absences: Absence[];
  /** Project assignments to write for the target dates. */
  draftAssignments: DraftAssignment[];
  /** Absence to write for the target dates (only used in absence mode). */
  draftAbsence?: DraftAbsence | null;
  /** Employee whose day is being edited. */
  employeeId: string;
  /** ISO date strings (YYYY-MM-DD) that the operation affects. */
  dates: string[];
  /** Whether the save writes project assignments or an absence. */
  mode: 'project' | 'absence';
}

export interface MergeDayEntriesOutput {
  assignments: Assignment[];
  absences: Absence[];
}

function createId(): string {
  return Math.random().toString(36).substr(2, 9);
}

/**
 * Returns the fraction of a full day an employee can work, derived from their
 * availability percentage. Missing or zero availability is treated as 100%.
 * The result is clamped to the range (0, 1].
 */
export function dailyCapacityFraction(emp: Pick<Employee, 'availability'>): number {
  const availability = emp.availability ?? 100;
  if (availability <= 0) return 1;
  return Math.min(availability / 100, 1);
}

/**
 * Determines whether a given daily load exceeds the employee's available
 * capacity. Uses a small epsilon to avoid floating-point surprises.
 */
export function isOverloaded(load: number, emp: Pick<Employee, 'availability'>): boolean {
  return load > dailyCapacityFraction(emp) + 1e-9;
}

/**
 * Converts an allocation fraction (share of a full 8-hour day) into hours,
 * rounded to one decimal place.
 */
export function allocationToHours(allocation: number): number {
  return Math.round(allocation * 8 * 10) / 10;
}

/**
 * Merges draft entries into an existing plan for a set of target dates.
 *
 * Merge semantics:
 * - Saving project assignments preserves existing absences on the same days.
 * - Saving an absence preserves existing project assignments on the same days.
 * - Existing entries of the same type as the save are replaced for the target
 *   dates, so re-saving an identical assignment does not create duplicates.
 */
export function mergeDayEntries(
  input: MergeDayEntriesInput
): MergeDayEntriesOutput {
  const { assignments, absences, draftAssignments, draftAbsence, employeeId, dates, mode } = input;

  const dateSet = new Set(dates);

  if (mode === 'project') {
    // Replace assignments for the target dates while preserving every absence.
    const keptAssignments = assignments.filter(
      (a) => !(a.employeeId === employeeId && dateSet.has(a.date))
    );

    const addedAssignments: Assignment[] = [];
    dates.forEach((dateStr) => {
      draftAssignments.forEach((draft) => {
        addedAssignments.push({
          id: draft.assignmentId || createId(),
          employeeId,
          projectId: draft.projectId,
          date: dateStr,
          allocation: draft.allocation,
        });
      });
    });

    return {
      assignments: [...keptAssignments, ...addedAssignments],
      absences,
    };
  }

  // Absence mode: replace absences for the target dates while preserving assignments.
  const keptAbsences = absences.filter(
    (a) => !(a.employeeId === employeeId && dateSet.has(a.date))
  );

  const addedAbsences: Absence[] = dates.map((dateStr) => ({
    id: createId(),
    employeeId,
    date: dateStr,
    type: draftAbsence?.type ?? 'vacation',
    approved: draftAbsence?.approved ?? true,
  }));

  return {
    assignments,
    absences: [...keptAbsences, ...addedAbsences],
  };
}
