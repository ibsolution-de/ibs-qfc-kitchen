import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PlannerCell } from './PlannerCell';
import { LanguageProvider } from '../../contexts/LanguageContext';
import type { Employee, Project, Assignment, Absence } from '../../types';

const renderWithLanguage = (ui: React.ReactElement) => render(<LanguageProvider>{ui}</LanguageProvider>);

const baseEmployee: Employee = {
  id: 'e1',
  name: 'Test Employee',
  role: 'Developer',
  avatar: 'https://example.com/avatar.png',
  skills: ['React'],
  availability: 100,
  email: 'test@example.com',
  location: 'DE',
  type: 'internal',
};

const baseProject: Project = {
  id: 'p1',
  name: 'Mission to Mars',
  client: 'NASA',
  color: 'blue',
  status: 'active',
};

const baseAssignment: Assignment = {
  id: 'a1',
  employeeId: 'e1',
  projectId: 'p1',
  date: '2024-06-10',
  allocation: 1,
};

const baseAbsence: Absence = {
  id: 'abs1',
  employeeId: 'e1',
  date: '2024-06-10',
  type: 'vacation',
  approved: true,
};

const baseDate = new Date(2024, 5, 10); // Monday
const noop = () => undefined;

const renderCell = (overrides: Partial<React.ComponentProps<typeof PlannerCell>> = {}) =>
  renderWithLanguage(
    <table>
      <tbody>
        <tr>
          <PlannerCell
            date={baseDate}
            employee={baseEmployee}
            entries={[]}
            projectMap={new Map([[baseProject.id, baseProject]])}
            absence={undefined}
            holiday={undefined}
            isInteractive={true}
            isClickable={true}
            isToday={false}
            isMonday={true}
            isWeekend={false}
            isOverloaded={false}
            hasConflict={false}
            readOnly={false}
            onCellClick={noop}
            onAddClick={noop}
            onDragStart={noop as unknown as (e: React.DragEvent, a: Assignment) => void}
            onDragEnd={noop}
            onDragOver={noop as unknown as (e: React.DragEvent, id: string, d: Date) => void}
            onDrop={noop as unknown as (e: React.DragEvent, id: string, d: Date) => void}
            onRemoveAssignment={noop}
            {...overrides}
          />
        </tr>
      </tbody>
    </table>
  );

describe('PlannerCell', () => {
  it('renders assignment chips for given entries', () => {
    renderCell({ entries: [baseAssignment] });
    const chips = screen.getAllByTestId('planner-cell-assignment');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent('Mission to Mars');
  });

  it('absence day renders read-only state', () => {
    renderCell({
      absence: baseAbsence,
      isInteractive: false,
      isClickable: true,
    });
    expect(screen.getByTestId('planner-cell-absence')).toBeInTheDocument();
  });

  it('overloaded cell shows overload styling', () => {
    renderCell({ isOverloaded: true });
    expect(screen.getByTestId('planner-cell-overload')).toBeInTheDocument();
  });
});
