import React, { useMemo } from 'react';
import { format } from 'date-fns';
import {
  X,
  PartyPopper,
  Sun,
  Umbrella,
  BookOpen,
  AlertCircle,
  Zap,
  Folder,
  Plus,
} from 'lucide-react';
import type { Assignment, Absence, Employee, PublicHoliday, Project } from '../../types';
import { PASTEL_VARIANTS } from '../../constants';
import { useLanguage } from '../../contexts/LanguageContext';
import { allocationToHours } from '../../utils/planner';

export interface PlannerCellProps {
  date: Date;
  employee: Employee;
  entries: Assignment[];
  projectMap: Map<string, Project>;
  absence: Absence | undefined;
  holiday: PublicHoliday | undefined;
  isInteractive: boolean;
  isClickable: boolean;
  isToday: boolean;
  isMonday: boolean;
  isWeekend: boolean;
  isOverloaded: boolean;
  hasConflict: boolean;
  readOnly: boolean;
  rowIndex: number;
  colIndex: number;
  isFocused: boolean;
  draggedProjectId?: string;
  draggedAssignmentId?: string;
  onCellClick: (employeeId: string, date: Date) => void;
  onAddClick: (employeeId: string, date: Date) => void;
  onDragStart: (e: React.DragEvent, assignment: Assignment) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, employeeId: string, date: Date) => void;
  onDrop: (e: React.DragEvent, employeeId: string, date: Date) => void;
  onRemoveAssignment: (assignmentId: string) => void;
  onKeyDown: (e: React.KeyboardEvent, employeeId: string, dateStr: string) => void;
  onFocus: (employeeId: string, dateStr: string) => void;
  registerCell: (key: string, el: HTMLTableCellElement | null) => void;
}

export const PlannerCell = React.memo<PlannerCellProps>(function PlannerCell({
  date,
  employee,
  entries,
  projectMap,
  absence,
  holiday,
  isInteractive,
  isClickable,
  isToday,
  isMonday,
  isWeekend,
  isOverloaded,
  hasConflict,
  readOnly,
  rowIndex,
  colIndex,
  isFocused,
  draggedProjectId,
  draggedAssignmentId,
  onCellClick,
  onAddClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onRemoveAssignment,
  onKeyDown,
  onFocus,
  registerCell,
}) {
  const { t, formatDate } = useLanguage();

  const dateStr = useMemo(() => format(date, 'yyyy-MM-dd'), [date]);
  const cellKey = useMemo(() => `${employee.id}|${dateStr}`, [employee.id, dateStr]);

  const isDuplicateDrop = useMemo(() => {
    if (!draggedProjectId || !isInteractive) return false;
    return entries.some(
      (a) => a.projectId === draggedProjectId && a.id !== draggedAssignmentId
    );
  }, [draggedProjectId, draggedAssignmentId, isInteractive, entries]);

  const handleClick = () => {
    if (isClickable) {
      onCellClick(employee.id, date);
    }
  };

  const handleAddClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddClick(employee.id, date);
  };

  const handleDragOver = (e: React.DragEvent) => {
    onDragOver(e, employee.id, date);
  };

  const handleDrop = (e: React.DragEvent) => {
    onDrop(e, employee.id, date);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    onKeyDown(e, employee.id, dateStr);
  };

  const handleFocus = () => {
    onFocus(employee.id, dateStr);
  };

  const ariaLabel = useMemo(() => {
    const parts: string[] = [`${employee.name}, ${formatDate(date, 'd. MMMM')}`];
    if (holiday) {
      parts.push(`${t('planner.holiday')}: ${holiday.name}`);
    } else if (absence) {
      parts.push(`${t('planner.absence')}: ${t(`planner.${absence.type}`)}`);
    } else if (entries.length === 0) {
      parts.push(t('planner.cellNoAssignments'));
    } else {
      const entryLabels = entries
        .map((a) => {
          const proj = projectMap.get(a.projectId);
          if (!proj) return '';
          const hours = allocationToHours(a.allocation);
          return `${hours}h ${proj.name}`;
        })
        .filter(Boolean);
      parts.push(entryLabels.join(', '));
    }
    return parts.join(': ');
  }, [employee.name, date, holiday, absence, entries, projectMap, t, formatDate]);

  const absenceStyle = absence
    ? ({
        backgroundImage:
          'repeating-linear-gradient(45deg, #f9fafb 25%, transparent 25%, transparent 50%, #f9fafb 50%, #f9fafb 75%, transparent 75%, transparent)',
        backgroundSize: '10px 10px',
      } as React.CSSProperties)
    : undefined;

  return (
    <td
      ref={(el) => registerCell(cellKey, el)}
      data-testid="planner-cell"
      data-cell-key={cellKey}
      role="gridcell"
      aria-label={ariaLabel}
      aria-rowindex={rowIndex + 3}
      aria-colindex={colIndex + 2}
      tabIndex={isFocused ? 0 : -1}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      className={`
        border-r border-charcoal-100 p-1 relative min-h-[7rem] h-auto align-top transition-all group/cell
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 focus-visible:z-20
        ${holiday
          ? 'bg-red-50/30 cursor-not-allowed pattern-diagonal-lines-sm text-red-800'
          : ''}
        ${absence ? 'bg-stripes-gray cursor-not-allowed opacity-80' : ''}
        ${isToday ? 'bg-blue-50/40 border-x-2 border-x-blue-200/50' : ''}
        ${isWeekend ? 'bg-charcoal-50/50 cursor-not-allowed' : ''}
        ${isOverloaded ? 'bg-red-50 hover:bg-red-100/50 cursor-pointer' : ''}
        ${!holiday && !absence && !isToday && !isWeekend && !isOverloaded
          ? 'bg-white cursor-pointer hover:bg-blue-50/30'
          : ''}
        ${isDuplicateDrop ? 'bg-red-50/40 cursor-not-allowed ring-inset ring-2 ring-red-100' : ''}
        ${isMonday ? 'border-l border-l-charcoal-200' : ''}
      `}
      style={absenceStyle}
    >
      <div className="absolute top-0.5 right-0.5 z-10 flex gap-0.5 justify-end">
        {hasConflict && !holiday && (
          <div title={t('planner.criticalConflict')} data-testid="planner-cell-conflict">
            <AlertCircle className="w-3 h-3 text-red-600 fill-white" />
          </div>
        )}
        {isOverloaded && !holiday && !absence && (
          <div
            title={t('planner.overload')}
            data-testid="planner-cell-overload"
            className="bg-red-100 rounded-full p-0.5 border border-red-200 shadow-sm"
          >
            <Zap className="w-2.5 h-2.5 text-red-600 fill-red-100" />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 pb-6">
        {holiday && (
          <div className="w-full h-full flex flex-col items-center justify-center text-center opacity-60">
            <PartyPopper className="w-4 h-4 text-red-400 mb-1" />
            <span className="text-[9px] font-bold text-red-400 uppercase leading-tight px-1 break-words w-full">
              {holiday.name}
            </span>
          </div>
        )}

        {absence && !holiday && (
          <div
            data-testid="planner-cell-absence"
            className="w-full h-full flex items-center justify-center relative group/absence"
          >
            <div className="text-xs font-semibold text-charcoal-400 rotate-45 flex flex-col items-center bg-white/50 p-1 rounded backdrop-blur-[1px] shadow-sm">
              {absence.type === 'vacation' && (
                <Sun className="w-4 h-4 mb-0.5 text-yellow-500" />
              )}
              {absence.type === 'sick' && (
                <Umbrella className="w-4 h-4 mb-0.5 text-red-500" />
              )}
              {absence.type === 'training' && (
                <BookOpen className="w-4 h-4 mb-0.5 text-blue-500" />
              )}
              <span className="text-[8px] uppercase">{t(`planner.${absence.type}`)}</span>
            </div>
          </div>
        )}

        {!absence &&
          !holiday &&
          entries.map((a) => {
            const proj = projectMap.get(a.projectId);
            if (!proj) return null;

            const allocation = a.allocation || 1;
            const hours = allocationToHours(allocation);
            const formattedHours =
              hours % 1 === 0 ? hours.toString() : hours.toFixed(1).replace(/\.0$/, '');
            const showHours = !(entries.length === 1 && hours === 8);

            return (
              <div
                key={a.id}
                draggable={!readOnly}
                data-testid="planner-cell-assignment"
                onDragStart={(e) => !readOnly && onDragStart(e, a)}
                onDragEnd={onDragEnd}
                className={`
                  text-[9px] pl-1 pr-0.5 py-0.5 rounded border shadow-sm select-none
                  ${(PASTEL_VARIANTS[proj.color] ?? PASTEL_VARIANTS.gray).bg}
                  ${(PASTEL_VARIANTS[proj.color] ?? PASTEL_VARIANTS.gray).text}
                  ${(PASTEL_VARIANTS[proj.color] ?? PASTEL_VARIANTS.gray).border}
                  ${!readOnly ? 'cursor-move hover:opacity-90 active:scale-95' : 'cursor-default'}
                  transition-transform flex items-center justify-between gap-1
                `}
                title={`${proj.name} (${formattedHours}h)`}
              >
                <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                  <Folder className="w-2.5 h-2.5 flex-shrink-0" />
                  <span className="truncate">{proj.name}</span>
                  {showHours && (
                    <span className="text-[8px] font-bold opacity-70 border border-current px-0.5 rounded whitespace-nowrap">
                      {formattedHours}h
                    </span>
                  )}
                </div>
                {isInteractive && (
                  <button
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onRemoveAssignment(a.id);
                    }}
                    className="opacity-0 group-hover/cell:opacity-100 pointer-coarse:opacity-100 hover:bg-black/10 p-0.5 pointer-coarse:p-1.5 pointer-coarse:min-w-6 pointer-coarse:min-h-6 rounded transition-opacity flex-shrink-0 ml-1 flex items-center justify-center"
                    title={t('planner.remove')}
                  >
                    <X className="w-2.5 h-2.5 pointer-coarse:w-3.5 pointer-coarse:h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
      </div>

      {isInteractive && !isDuplicateDrop && !absence && !holiday && (
        <div className="absolute bottom-1 left-1 right-1 opacity-0 group-hover/cell:opacity-100 pointer-coarse:opacity-100 transition-all duration-200 z-10 translate-y-2 group-hover/cell:translate-y-0 pointer-coarse:translate-y-0">
          <button
            onClick={handleAddClick}
            className="w-full h-5 pointer-coarse:h-7 bg-white/90 hover:bg-blue-50 border border-charcoal-200 hover:border-blue-200 text-charcoal-400 hover:text-blue-600 rounded flex items-center justify-center shadow-sm backdrop-blur-sm transition-colors"
            title={t('planner.oneClickAssign')}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </td>
  );
});

export default PlannerCell;
