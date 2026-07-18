import { describe, it, expect } from 'vitest';
import { computeTargetDates, mergeDayEntries, dailyCapacityFraction, isOverloaded, allocationToHours } from './planner';
import type { Assignment, Absence } from '../types';

const employeeId = 'emp-1';
const projectId = 'project-1';

const baseAssignment = (overrides: Partial<Assignment> = {}): Assignment => ({
  id: 'a-1',
  employeeId,
  projectId,
  date: '2024-06-10',
  allocation: 1,
  ...overrides,
});

const baseAbsence = (overrides: Partial<Absence> = {}): Absence => ({
  id: 'abs-1',
  employeeId,
  date: '2024-06-10',
  type: 'vacation',
  approved: true,
  ...overrides,
});

describe('planner', () => {
  describe('mergeDayEntries', () => {
    it('preserves an existing absence when saving a project on the same day', () => {
      const assignments: Assignment[] = [];
      const absences: Absence[] = [baseAbsence()];
      const result = mergeDayEntries({
        assignments,
        absences,
        draftAssignments: [{ projectId, allocation: 0.5 }],
        draftAbsence: null,
        employeeId,
        dates: ['2024-06-10'],
        mode: 'project',
      });

      expect(result.absences).toHaveLength(1);
      expect(result.absences[0]!.id).toBe('abs-1');
      expect(result.assignments).toHaveLength(1);
      expect(result.assignments[0]!).toMatchObject({
        employeeId,
        projectId,
        date: '2024-06-10',
        allocation: 0.5,
      });
    });

    it('preserves existing assignments when saving an absence on the same day', () => {
      const assignments: Assignment[] = [baseAssignment()];
      const absences: Absence[] = [];
      const result = mergeDayEntries({
        assignments,
        absences,
        draftAssignments: [],
        draftAbsence: { type: 'vacation', approved: true },
        employeeId,
        dates: ['2024-06-10'],
        mode: 'absence',
      });

      expect(result.assignments).toHaveLength(1);
      expect(result.assignments[0]!.id).toBe('a-1');
      expect(result.absences).toHaveLength(1);
      expect(result.absences[0]!).toMatchObject({
        employeeId,
        date: '2024-06-10',
        type: 'vacation',
        approved: true,
      });
    });

    it('preserves absences on every affected day in project repeat mode', () => {
      // June 2024 Mondays: 3, 10, 17, 24
      const dates = ['2024-06-03', '2024-06-10', '2024-06-17', '2024-06-24'];
      const absences: Absence[] = dates.map((date, idx) => baseAbsence({ id: `abs-${idx}`, date }));
      const result = mergeDayEntries({
        assignments: [],
        absences,
        draftAssignments: [{ projectId, allocation: 1 }],
        draftAbsence: null,
        employeeId,
        dates,
        mode: 'project',
      });

      expect(result.absences).toHaveLength(4);
      dates.forEach((date, idx) => {
        expect(result.absences.some((a) => a.id === `abs-${idx}` && a.date === date)).toBe(true);
      });
      expect(result.assignments).toHaveLength(4);
    });

    it('does not duplicate an identical assignment when re-saving in repeat mode', () => {
      const dates = ['2024-06-03', '2024-06-10', '2024-06-17', '2024-06-24'];
      const first = mergeDayEntries({
        assignments: [],
        absences: [],
        draftAssignments: [{ projectId, allocation: 1 }],
        draftAbsence: null,
        employeeId,
        dates,
        mode: 'project',
      });

      const second = mergeDayEntries({
        assignments: first.assignments,
        absences: [],
        draftAssignments: [{ projectId, allocation: 1 }],
        draftAbsence: null,
        employeeId,
        dates,
        mode: 'project',
      });

      expect(second.assignments).toHaveLength(4);
      expect(second.absences).toHaveLength(0);
    });
  });

  describe('computeTargetDates', () => {
    it('returns the base date for a single project save', () => {
      const result = computeTargetDates({
        baseDate: new Date(2024, 5, 10),
        mode: 'project',
      });
      expect(result).toEqual(['2024-06-10']);
    });

    it('returns repeated weekdays for project repeat mode', () => {
      const result = computeTargetDates({
        baseDate: new Date(2024, 5, 10), // Monday
        mode: 'project',
        isRepeat: true,
        repeatDays: [1], // Monday
      });
      expect(result).toEqual(['2024-06-03', '2024-06-10', '2024-06-17', '2024-06-24']);
    });

    it('skips weekends for consecutive absences', () => {
      const result = computeTargetDates({
        baseDate: new Date(2024, 5, 7), // Friday
        mode: 'absence',
        absenceDuration: 3,
      });
      expect(result).toEqual(['2024-06-07', '2024-06-10', '2024-06-11']);
    });
  });

  describe('dailyCapacityFraction', () => {
    it('treats missing or zero availability as 100%', () => {
      expect(dailyCapacityFraction({ availability: 0 })).toBe(1);
      expect(dailyCapacityFraction({ availability: undefined as unknown as number })).toBe(1);
    });

    it('returns availability as a fraction of a full day', () => {
      expect(dailyCapacityFraction({ availability: 100 })).toBe(1);
      expect(dailyCapacityFraction({ availability: 50 })).toBe(0.5);
      expect(dailyCapacityFraction({ availability: 75 })).toBe(0.75);
    });

    it('clamps the result to the range (0, 1]', () => {
      expect(dailyCapacityFraction({ availability: 150 })).toBe(1);
      expect(dailyCapacityFraction({ availability: -20 })).toBe(1);
    });
  });

  describe('isOverloaded', () => {
    it('flags load above the availability-adjusted capacity', () => {
      expect(isOverloaded(0.6, { availability: 50 })).toBe(true);
      expect(isOverloaded(0.5, { availability: 50 })).toBe(false);
      expect(isOverloaded(1.0, { availability: 100 })).toBe(false);
      expect(isOverloaded(1.01, { availability: 100 })).toBe(true);
    });

    it('treats missing or zero availability as full capacity', () => {
      expect(isOverloaded(1.0, { availability: 0 })).toBe(false);
      expect(isOverloaded(1.01, { availability: 0 })).toBe(true);
    });
  });

  describe('allocationToHours', () => {
    it('converts an allocation fraction to hours rounded to one decimal', () => {
      expect(allocationToHours(0.5)).toBe(4);
      expect(allocationToHours(1)).toBe(8);
      expect(allocationToHours(0.125)).toBe(1);
    });
  });
});
