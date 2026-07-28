import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResourcePlanner } from '../ResourcePlanner';
import { LanguageProvider } from '../../contexts/LanguageContext';
import { ToastProvider } from '../ui/Toast';
import { SettingsProvider } from '../../contexts/SettingsContext';
import type { Employee, Project, Assignment, Absence } from '../../types';

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: vi.fn((key: string) => (key === 'ibs_qfc_language' ? 'en' : null)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    },
    writable: true,
  });
});

const employees: Employee[] = [
  {
    id: 'e1',
    name: 'Test One',
    role: 'Developer',
    avatar: 'https://example.com/avatar1.png',
    skills: ['React'],
    availability: 100,
    email: 'one@example.com',
    location: 'DE',
    type: 'internal',
  },
  {
    id: 'e2',
    name: 'Test Two',
    role: 'Designer',
    avatar: 'https://example.com/avatar2.png',
    skills: ['Figma'],
    availability: 100,
    email: 'two@example.com',
    location: 'DE',
    type: 'internal',
  },
];

const projects: Project[] = [
  {
    id: 'p1',
    name: 'Test Project',
    client: 'Client',
    color: 'blue',
    status: 'active',
  },
];

const assignments: Assignment[] = [
  { id: 'a1', employeeId: 'e1', projectId: 'p1', date: '2026-03-02', allocation: 1 },
];

const absences: Absence[] = [];

const renderGrid = (props: Partial<React.ComponentProps<typeof ResourcePlanner>> = {}) => {
  const user = userEvent.setup();
  const onAssignmentChange = vi.fn();
  render(
    <LanguageProvider>
      <SettingsProvider>
        <ToastProvider>
          <ResourcePlanner
            employees={employees}
            projects={projects}
            assignments={assignments}
            absences={absences}
            onAssignmentChange={onAssignmentChange}
            onAbsenceChange={() => undefined}
            initialDate={new Date(2026, 2, 1)}
            {...props}
          />
        </ToastProvider>
      </SettingsProvider>
    </LanguageProvider>
  );
  return { user, onAssignmentChange };
};

describe('PlannerGrid keyboard navigation', () => {
  it('ArrowRight moves focus and tabindex to the next day cell', async () => {
    const { user } = renderGrid();
    const cells = screen.getAllByTestId('planner-cell');
    const firstCell = cells[0]!;
    expect(firstCell).toHaveAttribute('tabIndex', '0');

    await user.click(firstCell);
    expect(firstCell).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(cells[1]).toHaveFocus();
    expect(cells[1]).toHaveAttribute('tabIndex', '0');
    expect(cells[0]).toHaveAttribute('tabIndex', '-1');
  });

  it('Enter opens the day modal for a clickable cell', async () => {
    const { user } = renderGrid();
    const cells = screen.getAllByTestId('planner-cell');
    const firstCell = cells[0]!;
    await user.click(firstCell);
    await user.keyboard('{ArrowRight}');
    expect(cells[1]).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Delete on a single-assignment cell removes the assignment after confirm', async () => {
    const { user, onAssignmentChange } = renderGrid();
    const cells = screen.getAllByTestId('planner-cell');
    const firstCell = cells[0]!;
    await user.click(firstCell);
    await user.keyboard('{ArrowRight}');
    expect(cells[1]).toHaveFocus();

    await user.keyboard('{Delete}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Remove assignment')).toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'Remove' });
    await user.click(confirmButton);

    expect(onAssignmentChange).toHaveBeenCalledTimes(1);
    const firstCall = onAssignmentChange.mock.calls[0]!;
    const passed = firstCall[0] as Assignment[];
    expect(passed).toHaveLength(0);
  });

  it('Delete on a cell with no assignments does nothing', async () => {
    const { user } = renderGrid();
    const cells = screen.getAllByTestId('planner-cell');
    // First day of second employee has no assignments.
    const e2FirstDay = cells[cells.length / 2]!;
    await user.click(e2FirstDay);
    await user.keyboard('{Delete}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
