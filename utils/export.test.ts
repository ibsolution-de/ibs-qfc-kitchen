import { describe, it, expect } from 'vitest';
import { assignmentsToCSV, forecastToJSON } from './export';
import type { Employee, Project, Assignment, Absence, QuarterData } from '../types';

describe('export utils', () => {
  describe('assignmentsToCSV', () => {
    const employees: Employee[] = [
      {
        id: 'e1',
        name: 'Doe, John',
        role: 'Dev',
        avatar: '',
        skills: [],
        availability: 100,
        location: 'DE',
        type: 'internal',
      },
      {
        id: 'e2',
        name: 'Alice \"Bob\" Smith',
        role: 'PM',
        avatar: '',
        skills: [],
        availability: 100,
        location: 'DE',
        type: 'internal',
      },
    ];

    const projects: Project[] = [
      { id: 'p1', name: 'Project A', client: 'Client A', color: 'blue', status: 'active' },
      { id: 'p2', name: 'Project \"B\", C', client: 'Client B', color: 'green', status: 'active' },
    ];

    const assignments: Assignment[] = [
      { id: 'a1', employeeId: 'e1', projectId: 'p1', date: '2024-06-10', allocation: 0.5 },
      { id: 'a2', employeeId: 'e2', projectId: 'p2', date: '2024-06-11', allocation: 1 },
    ];

    const absences: Absence[] = [
      { id: 'ab1', employeeId: 'e1', date: '2024-06-12', type: 'vacation', approved: true },
      { id: 'ab2', employeeId: 'e2', date: '2024-06-13', type: 'sick', approved: true },
    ];

    it('escapes commas and quotes in names', () => {
      const csv = assignmentsToCSV(employees, projects, assignments, absences);
      expect(csv).toContain('"Doe, John"');
      expect(csv).toContain('"Alice ""Bob"" Smith"');
      expect(csv).toContain('"Project ""B"", C"');
    });

    it('includes absence rows with empty project and hours', () => {
      const csv = assignmentsToCSV(employees, projects, assignments, absences);
      const vacationRow = csv.split('\n').find(line => line.includes('vacation'));
      expect(vacationRow).toBeDefined();
      expect(vacationRow).toContain(',2024-06-12,,vacation');
    });

    it('produces the correct row count for mixed data', () => {
      const csv = assignmentsToCSV(employees, projects, assignments, absences);
      const lines = csv.trim().split('\n');
      expect(lines[0]).toBe('employee,project,date,allocation_hours,type');
      expect(lines).toHaveLength(1 + assignments.length + absences.length);
    });
  });

  describe('forecastToJSON', () => {
    it('round-trips to an equivalent object', () => {
      const quarters: QuarterData[] = [
        {
          id: 'q1',
          name: 'Q1 2024',
          months: ['Jan', 'Feb', 'Mar'],
          totalCapacity: [80, 80, 80],
          runningProjects: [],
          mustWinOpportunities: [],
          alternativeOpportunities: [],
          notes: 'test',
        },
      ];

      const json = forecastToJSON(quarters);
      expect(JSON.parse(json)).toEqual(quarters);
    });
  });
});
