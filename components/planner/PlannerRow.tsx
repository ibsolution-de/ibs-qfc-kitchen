import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { Employee, Project, Assignment, Absence, PublicHoliday } from '../../types';
import { PlannerCell } from './PlannerCell';
import { useLanguage } from '../../contexts/LanguageContext';

export interface CellViewModel {
  date: Date;
  dateStr: string;
  entries: Assignment[];
  absence: Absence | undefined;
  holiday: PublicHoliday | undefined;
  isInteractive: boolean;
  isClickable: boolean;
  isToday: boolean;
  isMonday: boolean;
  isWeekend: boolean;
  isOverloaded: boolean;
  hasConflict: boolean;
}

export interface RowViewModel {
  employee: Employee;
  stats: {
    capacity: number;
    plannedDays: number;
    freeDays: number;
    utilization: number;
  };
  cells: CellViewModel[];
}

export interface PlannerRowProps {
  row: RowViewModel;
  rowIndex: number;
  projectMap: Map<string, Project>;
  readOnly: boolean;
  draggedProjectId?: string;
  draggedAssignmentId?: string;
  onCellClick: (employeeId: string, date: Date) => void;
  onAddClick: (employeeId: string, date: Date) => void;
  onDragStart: (e: React.DragEvent, assignment: Assignment) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, employeeId: string, date: Date) => void;
  onDrop: (e: React.DragEvent, employeeId: string, date: Date) => void;
  onRemoveAssignment: (assignmentId: string) => void;
  onNavigateToEmployee?: (employeeId: string) => void;
  onCellKeyDown: (e: React.KeyboardEvent, employeeId: string, dateStr: string) => void;
  onCellFocus: (employeeId: string, dateStr: string) => void;
  registerCell: (key: string, el: HTMLTableCellElement | null) => void;
  focusedCellKey: string | null;
}

export const PlannerRow = React.memo<PlannerRowProps>(function PlannerRow({
  row,
  rowIndex,
  projectMap,
  readOnly,
  draggedProjectId,
  draggedAssignmentId,
  onCellClick,
  onAddClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onRemoveAssignment,
  onNavigateToEmployee,
  onCellKeyDown,
  onCellFocus,
  registerCell,
  focusedCellKey,
}) {
  const { t } = useLanguage();
  const { employee, stats, cells } = row;

  const handleEmployeeClick = () => {
    onNavigateToEmployee?.(employee.id);
  };

  const utilizationClass =
    stats.utilization > 100
      ? 'bg-red-100 text-red-800 border-red-200'
      : stats.utilization >= 80
        ? 'bg-green-50 text-green-700 border-green-100'
        : stats.utilization >= 50
          ? 'bg-blue-50 text-blue-700 border-blue-100'
          : 'bg-yellow-50 text-yellow-700 border-yellow-200';

  return (
    <tr role="row" aria-rowindex={rowIndex + 3} className="group hover:bg-charcoal-50/30 transition-colors border-b border-charcoal-100 last:border-0">
      <td
        role="rowheader"
        aria-colindex={1}
        className="sticky left-0 z-10 bg-white group-hover:bg-charcoal-50/30 border-r border-charcoal-200 p-3 shadow-[2px_0_5px_rgba(0,0,0,0.05)] cursor-pointer hover:bg-blue-50/20 align-top"
        onClick={handleEmployeeClick}
        title={t('planner.viewEmployeeOverview')}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <img
              src={employee.avatar}
              alt={employee.name}
              className="w-9 h-9 rounded-full border border-charcoal-100"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 group-hover:text-blue-600 transition-colors">
                <div className="text-sm font-bold text-charcoal-900 truncate">{employee.name}</div>
                <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-50" />
              </div>
              <div className="text-xs text-charcoal-500 truncate flex items-center gap-1">
                {employee.role} • <span className="uppercase">{employee.location}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 px-0.5 mt-1 border-t border-charcoal-100">
            <div className="flex items-baseline gap-2 text-xs">
              <span className="text-charcoal-600" title={t('planner.plannedCapacity')}>
                <span className="font-semibold text-charcoal-900">{stats.plannedDays}</span> / {stats.capacity}d
              </span>
              <span
                className={`text-[10px] ml-1.5 font-medium px-1 rounded ${
                  stats.freeDays < 0 ? 'text-red-600 bg-red-50' : 'text-charcoal-400'
                }`}
                title={t('planner.freeDays')}
              >
                {stats.freeDays > 0 ? `+${stats.freeDays}` : stats.freeDays}
              </span>
            </div>

            <div
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border min-w-[36px] text-center ${utilizationClass}`}
              title={`${stats.utilization}%`}
            >
              {stats.utilization}%
            </div>
          </div>
        </div>
      </td>
      {cells.map((cell, colIndex) => (
        <PlannerCell
          key={cell.dateStr}
          date={cell.date}
          employee={employee}
          entries={cell.entries}
          projectMap={projectMap}
          absence={cell.absence}
          holiday={cell.holiday}
          isInteractive={cell.isInteractive}
          isClickable={cell.isClickable}
          isToday={cell.isToday}
          isMonday={cell.isMonday}
          isWeekend={cell.isWeekend}
          isOverloaded={cell.isOverloaded}
          hasConflict={cell.hasConflict}
          readOnly={readOnly}
          rowIndex={rowIndex}
          colIndex={colIndex}
          isFocused={focusedCellKey === `${employee.id}|${cell.dateStr}`}
          draggedProjectId={draggedProjectId}
          draggedAssignmentId={draggedAssignmentId}
          onCellClick={onCellClick}
          onAddClick={onAddClick}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onRemoveAssignment={onRemoveAssignment}
          onKeyDown={onCellKeyDown}
          onFocus={onCellFocus}
          registerCell={registerCell}
        />
      ))}
    </tr>
  );
});

export default PlannerRow;
