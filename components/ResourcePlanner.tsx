import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  format,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  addMonths,
  isWeekend,
  isToday,
  getISOWeek,
  startOfQuarter,
  addQuarters,
  getDay,
  isSameMonth,
} from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Info,
  Share2,
  Filter,
  Folder,
  AlertCircle,
  Zap,
  Activity,
  Calendar,
  CalendarCheck,
  Lock,
  Flag,
} from 'lucide-react';
import { Employee, Project, Assignment, TimeScale, Absence } from '../types';
import { PASTEL_VARIANTS, MOCK_HOLIDAYS } from '../constants';
import { Button } from './ui/Button';
import { useLanguage } from '../contexts/LanguageContext';
import { Modal } from './ui/Modal';
import { ResourcePlanChat } from './ResourcePlanChat';
import {
  isOverloaded,
  dailyCapacityFraction,
} from '../utils/planner';
import { assignmentsToCSV, downloadTextFile } from '../utils/export';
import { useToast } from './ui/Toast';
import { PlannerRow, RowViewModel } from './planner/PlannerRow';
import { DayEditModal } from './planner/DayEditModal';

interface ResourcePlannerProps {
  employees: Employee[];
  assignments: Assignment[];
  absences: Absence[];
  projects: Project[];
  onAssignmentChange: (assignments: Assignment[]) => void;
  onAbsenceChange: (absences: Absence[]) => void;
  onNavigateToEmployee?: (employeeId: string) => void;
  initialDate?: Date;
  readOnly?: boolean;
}

// Discriminated union for the active project filter in the planner grid
type ProjectFilter =
  | { kind: 'all' }
  | { kind: 'status'; status: 'active' | 'opportunity' }
  | { kind: 'project'; projectId: string };

// --- Index-based data helpers ---

function buildAssignmentIndex(assignments: Assignment[]) {
  const index = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const key = `${a.employeeId}|${a.date}`;
    const list = index.get(key);
    if (list) {
      list.push(a);
    } else {
      index.set(key, [a]);
    }
  }
  return index;
}

function buildAbsenceIndex(absences: Absence[]) {
  const index = new Map<string, Absence[]>();
  for (const a of absences) {
    const key = `${a.employeeId}|${a.date}`;
    const list = index.get(key);
    if (list) {
      list.push(a);
    } else {
      index.set(key, [a]);
    }
  }
  return index;
}

function getCellData(
  empId: string,
  date: Date,
  filteredAssignmentIndex: Map<string, Assignment[]>,
  absenceIndex: Map<string, Absence[]>,
  employees: Employee[]
) {
  const dateStr = format(date, 'yyyy-MM-dd');
  const key = `${empId}|${dateStr}`;

  const cellAssignments = filteredAssignmentIndex.get(key) || [];
  const absence = absenceIndex.get(key)?.[0];
  const employee = employees.find((e) => e.id === empId);
  const holiday = MOCK_HOLIDAYS.find(
    (h) => h.date === dateStr && (h.location === 'ALL' || h.location === employee?.location)
  );

  return { assignments: cellAssignments, absence, holiday };
}

function getDailyLoad(
  empId: string,
  dateStr: string,
  assignmentIndex: Map<string, Assignment[]>
) {
  const list = assignmentIndex.get(`${empId}|${dateStr}`) || [];
  const load = list.reduce((sum, a) => sum + (a.allocation || 1), 0);
  return Math.round(load * 100) / 100;
}

function getMonthStats(
  monthStart: Date,
  assignmentIndex: Map<string, Assignment[]>,
  absenceIndex: Map<string, Absence[]>,
  projectMap: Map<string, Project>,
  employees: Employee[],
  assignments: Assignment[]
) {
  const start = startOfMonth(monthStart);
  const end = endOfMonth(monthStart);
  const daysInMonth = eachDayOfInterval({ start, end });
  const monthStartStr = format(start, 'yyyy-MM-dd');
  const monthEndStr = format(end, 'yyyy-MM-dd');

  let totalCapacity = 0;
  let totalPlanned = 0;
  let overloadedDaysCount = 0;
  const projectLoadMap = new Map<string, number>();

  employees.forEach((emp) => {
    daysInMonth.forEach((day) => {
      if (isWeekend(day)) return;
      const dStr = format(day, 'yyyy-MM-dd');

      const isHoliday = MOCK_HOLIDAYS.some(
        (h) => h.date === dStr && (h.location === 'ALL' || h.location === emp.location)
      );
      if (isHoliday) return;

      const isAbsent = absenceIndex.has(`${emp.id}|${dStr}`);
      if (isAbsent) return;

      totalCapacity += dailyCapacityFraction(emp);

      const dailyAssignments = assignmentIndex.get(`${emp.id}|${dStr}`) || [];
      const dailyLoad = dailyAssignments.reduce((acc, a) => acc + (a.allocation || 1), 0);

      if (isOverloaded(dailyLoad, emp)) {
        overloadedDaysCount++;
      }
    });
  });

  assignments.forEach((a) => {
    if (a.date >= monthStartStr && a.date <= monthEndStr) {
      const val = a.allocation || 1;
      totalPlanned += val;

      const currentProjVal = projectLoadMap.get(a.projectId) || 0;
      projectLoadMap.set(a.projectId, currentProjVal + val);
    }
  });

  type ProjectStat = { id: string; val: number; project: Project };
  const projectStats = Array.from(projectLoadMap.entries())
    .map(([id, val]) => ({ id, val, project: projectMap.get(id) }))
    .filter((item): item is ProjectStat => Boolean(item.project))
    .sort((a, b) => b.val - a.val)
    .slice(0, 3);

  return {
    totalCapacity: Math.round(totalCapacity * 10) / 10,
    totalPlanned: Math.round(totalPlanned * 10) / 10,
    freeCapacity: Math.round((totalCapacity - totalPlanned) * 10) / 10,
    overloadedDaysCount,
    projectStats,
  };
}

function getEmployeeStats(
  emp: Employee,
  monthDays: Date[],
  assignmentIndex: Map<string, Assignment[]>,
  absenceIndex: Map<string, Absence[]>
) {
  const workingDays = monthDays.filter((d) => {
    if (isWeekend(d)) return false;
    const dStr = format(d, 'yyyy-MM-dd');
    const isHoliday = MOCK_HOLIDAYS.some(
      (h) => h.date === dStr && (h.location === 'ALL' || h.location === emp.location)
    );
    return !isHoliday;
  });

  let validAbsences = 0;
  let plannedLoad = 0;

  monthDays.forEach((d) => {
    if (isWeekend(d)) return;
    const dStr = format(d, 'yyyy-MM-dd');
    const isHoliday = MOCK_HOLIDAYS.some(
      (h) => h.date === dStr && (h.location === 'ALL' || h.location === emp.location)
    );
    if (isHoliday) return;

    const key = `${emp.id}|${dStr}`;
    if (absenceIndex.has(key)) {
      validAbsences++;
    }

    const dailyAssignments = assignmentIndex.get(key) || [];
    plannedLoad += dailyAssignments.reduce((acc, a) => acc + (a.allocation || 1), 0);
  });

  const effectiveWorkingDays = workingDays.length - validAbsences;
  const capacity = Math.round(effectiveWorkingDays * dailyCapacityFraction(emp) * 10) / 10;

  const freeDays = Math.round((capacity - plannedLoad) * 10) / 10;
  const utilization = capacity > 0 ? Math.round((plannedLoad / capacity) * 100) : 0;

  return {
    capacity,
    plannedDays: Math.round(plannedLoad * 10) / 10,
    freeDays,
    utilization,
  };
}

function hasCriticalConflict(
  assignments: Assignment[],
  projectMap: Map<string, Project>
) {
  const criticalCount = assignments.reduce((count, a) => {
    const p = projectMap.get(a.projectId);
    return p?.isCritical ? count + 1 : count;
  }, 0);
  return criticalCount > 1;
}

export const ResourcePlanner: React.FC<ResourcePlannerProps> = ({
  employees,
  assignments,
  absences,
  projects,
  onAssignmentChange,
  onAbsenceChange,
  onNavigateToEmployee,
  initialDate,
  readOnly = false,
}) => {
  const { t, formatDate } = useLanguage();
  const { success } = useToast();
  const [currentDate, setCurrentDate] = useState(initialDate || new Date());
  const lastInitDateRef = useRef(initialDate ? initialDate.getTime() : 0);
  const todayCellRef = useRef<HTMLTableCellElement>(null);

  // View State
  const [timeScale, setTimeScale] = useState<TimeScale>(TimeScale.MONTH);
  const [showLegend, setShowLegend] = useState(false);
  const [activeProjectFilter, setActiveProjectFilter] = useState<ProjectFilter>({
    kind: 'all',
  });

  // Interaction State
  const [selectedCell, setSelectedCell] = useState<{ empId: string; date: Date } | null>(null);

  // Drag and Drop state
  const [draggingAssignmentId, setDraggingAssignmentId] = useState<string | null>(null);

  // Initialize date if initialDate prop changes significantly (value change, not just ref)
  useEffect(() => {
    if (initialDate) {
      const newTime = initialDate.getTime();
      if (newTime !== lastInitDateRef.current) {
        setCurrentDate(initialDate);
        lastInitDateRef.current = newTime;
      }
    }
  }, [initialDate]);

  // Today-jump scroll: scroll to the today column whenever the current date changes
  useEffect(() => {
    if (todayCellRef.current) {
      todayCellRef.current.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    }
  }, [currentDate]);

  // Calculate months to render based on timeScale
  const monthsToRender = useMemo(() => {
    if (timeScale === TimeScale.MONTH) {
      return [startOfMonth(currentDate)];
    } else {
      const start = startOfQuarter(currentDate);
      return [0, 1, 2].map((i) => addMonths(start, i));
    }
  }, [currentDate, timeScale]);

  const headerTitle = useMemo(() => {
    if (timeScale === TimeScale.MONTH) {
      return formatDate(currentDate, 'MMMM yyyy');
    }
    const quarter = Math.floor(startOfQuarter(currentDate).getMonth() / 3) + 1;
    return `Q${quarter} ${formatDate(currentDate, 'yyyy')}`;
  }, [currentDate, timeScale, formatDate]);

  const handlePrev = useCallback(() => {
    if (timeScale === TimeScale.QUARTER) {
      setCurrentDate((prev) => addQuarters(prev, -1));
    } else {
      setCurrentDate((prev) => addMonths(prev, -1));
    }
  }, [timeScale]);

  const handleNext = useCallback(() => {
    if (timeScale === TimeScale.QUARTER) {
      setCurrentDate((prev) => addQuarters(prev, 1));
    } else {
      setCurrentDate((prev) => addMonths(prev, 1));
    }
  }, [timeScale]);

  const handleTodayJump = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const projectMap = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) {
      map.set(p.id, p);
    }
    return map;
  }, [projects]);

  const assignmentIndex = useMemo(() => buildAssignmentIndex(assignments), [assignments]);
  const absenceIndex = useMemo(() => buildAbsenceIndex(absences), [absences]);

  const filteredAssignmentIndex = useMemo(() => {
    if (activeProjectFilter.kind === 'all') return assignmentIndex;

    const index = new Map<string, Assignment[]>();
    for (const [key, list] of assignmentIndex) {
      const filtered = list.filter((a) => {
        if (activeProjectFilter.kind === 'status') {
          const p = projectMap.get(a.projectId);
          return p && p.status === activeProjectFilter.status;
        }
        return a.projectId === activeProjectFilter.projectId;
      });
      if (filtered.length > 0) index.set(key, filtered);
    }
    return index;
  }, [assignmentIndex, activeProjectFilter, projectMap]);

  // Get active project details (for milestone display)
  const filteredProject = useMemo(
    () =>
      activeProjectFilter.kind === 'project'
        ? projectMap.get(activeProjectFilter.projectId)
        : undefined,
    [activeProjectFilter, projectMap]
  );

  const draggedAssignment = useMemo(
    () =>
      draggingAssignmentId
        ? assignments.find((a) => a.id === draggingAssignmentId) ?? null
        : null,
    [draggingAssignmentId, assignments]
  );

  // --- Stable event handlers ---
  const handleCellClick = useCallback((employeeId: string, date: Date) => {
    setSelectedCell({ empId: employeeId, date });
  }, []);

  const handleAddClick = useCallback((employeeId: string, date: Date) => {
    setSelectedCell({ empId: employeeId, date });
  }, []);

  const handleDragStart = useCallback(
    (e: React.DragEvent, assignment: Assignment) => {
      if (readOnly) return;
      e.dataTransfer.setData('assignmentId', assignment.id);
      e.dataTransfer.setData('empId', assignment.employeeId);
      e.dataTransfer.effectAllowed = 'move';
      setDraggingAssignmentId(assignment.id);
    },
    [readOnly]
  );

  const handleDragEnd = useCallback(() => {
    setDraggingAssignmentId(null);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, targetEmpId: string, targetDate: Date) => {
      if (readOnly) return;

      if (draggingAssignmentId) {
        const draggedAssignment = assignments.find((a) => a.id === draggingAssignmentId);
        if (draggedAssignment) {
          const targetDateStr = format(targetDate, 'yyyy-MM-dd');

          const hasAbsence = absences.some(
            (a) => a.employeeId === targetEmpId && a.date === targetDateStr
          );
          if (hasAbsence) {
            e.dataTransfer.dropEffect = 'none';
            return;
          }

          const hasProject = assignments.some(
            (a) =>
              a.employeeId === targetEmpId &&
              a.date === targetDateStr &&
              a.projectId === draggedAssignment.projectId &&
              a.id !== draggingAssignmentId
          );

          if (hasProject) {
            e.dataTransfer.dropEffect = 'none';
            return;
          }
        }
      }

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    [readOnly, draggingAssignmentId, assignments, absences]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, targetEmpId: string, targetDate: Date) => {
      if (readOnly) return;
      e.preventDefault();
      setDraggingAssignmentId(null);

      const assignmentId = e.dataTransfer.getData('assignmentId');
      const targetDateStr = format(targetDate, 'yyyy-MM-dd');

      const hasAbsence = absences.some(
        (a) => a.employeeId === targetEmpId && a.date === targetDateStr
      );
      if (hasAbsence) return;

      const draggedAssignment = assignments.find((a) => a.id === assignmentId);
      if (draggedAssignment) {
        const hasProject = assignments.some(
          (a) =>
            a.employeeId === targetEmpId &&
            a.date === targetDateStr &&
            a.projectId === draggedAssignment.projectId &&
            a.id !== assignmentId
        );
        if (hasProject) return;
      }

      const updatedAssignments = assignments.map((a) => {
        if (a.id === assignmentId) {
          return { ...a, date: targetDateStr, employeeId: targetEmpId };
        }
        return a;
      });

      onAssignmentChange(updatedAssignments);
    },
    [readOnly, assignments, absences, onAssignmentChange]
  );

  const handleRemoveAssignment = useCallback(
    (assignmentId: string) => {
      if (readOnly) return;
      onAssignmentChange(assignments.filter((a) => a.id !== assignmentId));
    },
    [readOnly, assignments, onAssignmentChange]
  );

  const handleSaveFromModal = useCallback(
    (newAssignments: Assignment[], newAbsences: Absence[]) => {
      onAssignmentChange(newAssignments);
      onAbsenceChange(newAbsences);
      setSelectedCell(null);
    },
    [onAssignmentChange, onAbsenceChange]
  );

  const handleDeleteAbsenceFromModal = useCallback(
    (employeeId: string, dateStr: string) => {
      if (readOnly) return;
      onAbsenceChange(absences.filter((a) => !(a.employeeId === employeeId && a.date === dateStr)));
      setSelectedCell(null);
    },
    [readOnly, onAbsenceChange, absences]
  );

  const handleExportCSV = useCallback(() => {
    const csv = assignmentsToCSV(employees, projects, assignments, absences);
    const filename = `resource-plan-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    downloadTextFile(filename, csv, 'text/csv;charset=utf-8');
    success(t('toast.csvExported'));
  }, [employees, projects, assignments, absences, success, t]);

  // --- Pre-computed grid view model ---
  const gridViewModel = useMemo(() => {
    return monthsToRender.map((monthStart) => {
      const daysInMonth = eachDayOfInterval({
        start: startOfMonth(monthStart),
        end: endOfMonth(monthStart),
      });
      const isCurrentMonth = isSameMonth(monthStart, new Date());

      const weeks: { week: number; count: number }[] = [];
      daysInMonth.forEach((day) => {
        const w = getISOWeek(day);
        if (weeks.length > 0 && weeks[weeks.length - 1]!.week === w) {
          weeks[weeks.length - 1]!.count++;
        } else {
          weeks.push({ week: w, count: 1 });
        }
      });

      const monthStats = getMonthStats(
        monthStart,
        assignmentIndex,
        absenceIndex,
        projectMap,
        employees,
        assignments
      );

      const rows: RowViewModel[] = employees.map((emp) => {
        const stats = getEmployeeStats(emp, daysInMonth, assignmentIndex, absenceIndex);
        const cells = daysInMonth.map((day) => {
          const { assignments: dayAssignments, absence, holiday } = getCellData(
            emp.id,
            day,
            filteredAssignmentIndex,
            absenceIndex,
            employees
          );
          const isWknd = isWeekend(day);
          const isMonday = getDay(day) === 1;
          const isTodayCell = isToday(day);
          const isInteractive = !readOnly && !isWknd && !holiday && !absence;
          const isCellClickable = !readOnly && !isWknd && !holiday;
          const dailyLoad = getDailyLoad(emp.id, format(day, 'yyyy-MM-dd'), assignmentIndex);
          const cellIsOverloaded = isOverloaded(dailyLoad, emp);
          const conflict = hasCriticalConflict(dayAssignments, projectMap);

          return {
            date: day,
            dateStr: format(day, 'yyyy-MM-dd'),
            entries: dayAssignments,
            absence,
            holiday,
            isInteractive,
            isClickable: isCellClickable,
            isToday: isTodayCell,
            isMonday,
            isWeekend: isWknd,
            isOverloaded: cellIsOverloaded,
            hasConflict: conflict,
          };
        });

        return { employee: emp, stats, cells };
      });

      return { monthStart, daysInMonth, weeks, isCurrentMonth, monthStats, rows };
    });
  }, [
    monthsToRender,
    employees,
    assignmentIndex,
    absenceIndex,
    projectMap,
    assignments,
    filteredAssignmentIndex,
    readOnly,
  ]);

  return (
    <div className="flex flex-col h-full bg-gray-50/50 relative">
      {/* Toolbar */}
      <div className="flex-none bg-white border-b border-charcoal-200 px-6 py-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-white rounded-md shadow-sm border border-charcoal-200 p-0.5">
            <button
              onClick={handlePrev}
              aria-label={t('planner.previousMonth')}
              className="p-1.5 hover:bg-charcoal-100 rounded-md text-charcoal-500"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="px-4 font-semibold text-charcoal-800 min-w-[160px] text-center">
              {headerTitle}
            </div>
            <button
              onClick={handleNext}
              aria-label={t('planner.nextMonth')}
              className="p-1.5 hover:bg-charcoal-100 rounded-md text-charcoal-500"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleTodayJump}
            className="text-charcoal-600 border border-charcoal-200 hover:bg-charcoal-50"
          >
            <CalendarCheck className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">{t('planner.today')}</span>
          </Button>

          {readOnly && (
            <div className="px-2 py-0.5 rounded text-xs font-bold bg-charcoal-100 text-charcoal-500 flex items-center gap-1 border border-charcoal-200">
              <Lock className="w-3 h-3" /> {t('planner.readOnly')}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant={timeScale === TimeScale.MONTH ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setTimeScale(TimeScale.MONTH)}
            >
              {t('planner.month')}
            </Button>
            <Button
              variant={timeScale === TimeScale.QUARTER ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setTimeScale(TimeScale.QUARTER)}
            >
              {t('planner.quarter')}
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Project Filter */}
          <div className="relative flex items-center">
            <label htmlFor="project-filter" className="sr-only">
              {t('planner.filterProject')}
            </label>
            <Filter className="absolute left-2.5 w-4 h-4 text-charcoal-400 pointer-events-none" />
            <select
              id="project-filter"
              value={
                activeProjectFilter.kind === 'all'
                  ? 'all'
                  : activeProjectFilter.kind === 'status'
                    ? `status:${activeProjectFilter.status}`
                    : activeProjectFilter.projectId
              }
              onChange={(e) => {
                const value = e.target.value;
                if (value === 'all') {
                  setActiveProjectFilter({ kind: 'all' });
                } else if (value === 'status:active') {
                  setActiveProjectFilter({ kind: 'status', status: 'active' });
                } else if (value === 'status:opportunity') {
                  setActiveProjectFilter({ kind: 'status', status: 'opportunity' });
                } else {
                  setActiveProjectFilter({ kind: 'project', projectId: value });
                }
              }}
              className="pl-9 pr-8 py-1.5 h-9 bg-white border border-charcoal-200 rounded-md text-sm font-medium text-charcoal-600 focus:outline-none focus:ring-2 focus:ring-charcoal-400 hover:bg-charcoal-50 appearance-none cursor-pointer min-w-[160px]"
            >
              <option value="all">{t('planner.allProjects')}</option>
              <option value="status:active">{t('planner.filterActive')}</option>
              <option value="status:opportunity">{t('planner.filterOpportunity')}</option>
              <optgroup label={t('projects.title')}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none border-l-4 border-l-transparent border-r-4 border-r-transparent border-t-4 border-t-charcoal-400"></div>
          </div>

          <button
            onClick={() => setShowLegend(true)}
            aria-label={t('planner.legend')}
            className={`p-2 rounded-md transition-colors ${
              showLegend ? 'bg-blue-100 text-blue-700' : 'hover:bg-charcoal-100 text-charcoal-500'
            }`}
          >
            <Info className="w-5 h-5" />
          </button>
          <Button variant="outline" className="gap-2" size="sm" onClick={handleExportCSV}>
            <Share2 className="w-4 h-4" />
            {t('planner.exportCSV')}
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <div className="flex flex-col gap-8 max-w-[100vw]">
          {gridViewModel.map((month) => {
            return (
              <div
                key={month.monthStart.toISOString()}
                className="bg-white rounded-xl shadow-sm border border-charcoal-200 flex flex-col"
              >
                {/* Month Header */}
                <div className="px-6 py-4 border-b border-charcoal-200 bg-charcoal-50 flex items-center justify-between gap-4 rounded-t-xl">
                  <div className="flex items-center">
                    <h3 className="text-lg font-bold text-charcoal-900 leading-none">
                      {formatDate(month.monthStart, 'MMMM yyyy')}
                    </h3>

                    <div
                      className="flex items-center gap-0.5 ml-1.5 relative -top-1.5 text-charcoal-400 select-none"
                      title={`${month.daysInMonth.length} ${t('planner.days')}`}
                    >
                      <Calendar className="w-2.5 h-2.5" />
                      <span className="text-[9px] font-bold leading-none">
                        {month.daysInMonth.length}
                      </span>
                    </div>

                    {month.isCurrentMonth && (
                      <span className="ml-3 text-[10px] font-bold text-blue-600 bg-white border border-blue-200 px-2 py-0.5 rounded-full uppercase tracking-wide">
                        {t('planner.current')}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-xs hidden lg:flex">
                    <div
                      className="flex items-center gap-1.5"
                      title={`${t('planner.tooltipCapacity')}: ${month.monthStats.totalPlanned} / ${month.monthStats.totalCapacity}`}
                    >
                      <Activity className="w-3.5 h-3.5 text-charcoal-400" />
                      <span className="font-bold text-charcoal-700">
                        {Math.round(
                          (month.monthStats.totalPlanned / (month.monthStats.totalCapacity || 1)) * 100
                        )}
                        %
                      </span>
                      <span className="text-charcoal-400">
                        ({month.monthStats.totalPlanned}/{month.monthStats.totalCapacity}d)
                      </span>
                    </div>

                    <div
                      title={t('planner.tooltipFree')}
                      className={`font-medium px-2 py-0.5 rounded-md border ${
                        month.monthStats.freeCapacity < 0
                          ? 'bg-red-50 text-red-700 border-red-100'
                          : 'bg-green-50 text-green-700 border-green-100'
                      }`}
                    >
                      {month.monthStats.freeCapacity > 0 ? '+' : ''}
                      {month.monthStats.freeCapacity}d
                    </div>

                    {month.monthStats.overloadedDaysCount > 0 && (
                      <div
                        className="flex items-center gap-1 text-red-600 font-bold bg-red-50 px-1.5 py-0.5 rounded-full border border-red-100"
                        title={t('planner.tooltipOverload')}
                      >
                        <Zap className="w-3 h-3 fill-red-100" />
                        {month.monthStats.overloadedDaysCount}d
                      </div>
                    )}

                    <div className="w-px h-4 bg-charcoal-200"></div>

                    <div className="flex items-center gap-2">
                      {month.monthStats.projectStats.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-1 px-1.5 py-0.5 bg-white border border-charcoal-200 rounded-full shadow-sm"
                          title={`${item.project!.name} (${item.project!.client}): ${item.val}d`}
                        >
                          <div
                            className={`w-1.5 h-1.5 rounded-full ${
                              (PASTEL_VARIANTS[item.project!.color] ?? PASTEL_VARIANTS.gray).dot
                            }`}
                          ></div>
                          <span className="text-[10px] font-medium text-charcoal-600 max-w-[80px] truncate">
                            {item.project!.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Grid */}
                <div className="overflow-x-auto custom-scrollbar rounded-b-xl">
                  <table className="w-full border-collapse">
                    <thead className="bg-white">
                      <tr className="h-6 border-b border-charcoal-200">
                        <th
                          className="sticky left-0 top-0 z-30 bg-charcoal-50 border-r border-charcoal-200 w-64 min-w-[280px] text-left px-4 shadow-[2px_0_5px_rgba(0,0,0,0.05)]"
                          rowSpan={2}
                        >
                          <span className="text-xs font-semibold text-charcoal-500 uppercase tracking-wider">
                            {t('planner.employee')}
                          </span>
                        </th>
                        {month.weeks.map((week, idx) => (
                          <th
                            key={`week-${week.week}-${idx}`}
                            colSpan={week.count}
                            className="sticky top-0 z-20 bg-charcoal-50/50 border-r border-charcoal-200 text-[10px] text-charcoal-500 font-medium text-center uppercase tracking-wider"
                          >
                            {t('planner.week')} {week.week}
                          </th>
                        ))}
                      </tr>
                      <tr className="h-10 border-b border-charcoal-200">
                        {month.daysInMonth.map((day) => {
                          const isWknd = isWeekend(day);
                          const isMonday = getDay(day) === 1;
                          const isTodayCell = isToday(day);
                          const dateStr = format(day, 'yyyy-MM-dd');

                          const isGlobalHoliday = MOCK_HOLIDAYS.some(
                            (h) => h.date === dateStr && h.location === 'DE'
                          );
                          const milestone = filteredProject?.milestones?.find(
                            (m) => m.date === dateStr
                          );

                          return (
                            <th
                              key={day.toISOString()}
                              ref={isTodayCell ? todayCellRef : undefined}
                              className={`
                                sticky top-6 z-20
                                min-w-[40px] w-10 text-center border-r border-charcoal-100 p-1
                                ${isWknd || isGlobalHoliday ? 'bg-charcoal-50/50' : 'bg-white'}
                                ${isMonday ? 'border-l border-l-charcoal-300' : ''}
                                ${isTodayCell ? 'bg-blue-50/30' : ''}
                                ${milestone ? 'bg-purple-50' : ''}
                              `}
                            >
                              <div className="flex flex-col items-center justify-center relative">
                                {milestone && (
                                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-30 group/milestone">
                                    <Flag className="w-3.5 h-3.5 text-purple-600 fill-purple-100" />
                                    <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 bg-charcoal-800 text-white text-[10px] rounded px-2 py-1 opacity-0 group-hover/milestone:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                                      {milestone.name}
                                    </div>
                                  </div>
                                )}
                                <span
                                  className={`text-[9px] font-bold uppercase mb-0.5 ${
                                    isTodayCell
                                      ? 'text-blue-600'
                                      : isMonday
                                        ? 'text-blue-600'
                                        : isGlobalHoliday
                                          ? 'text-red-500'
                                          : 'text-charcoal-400'
                                  }`}
                                >
                                  {formatDate(day, 'EEE')}
                                </span>
                                <div
                                  className={`flex items-center justify-center w-6 h-6 rounded-full transition-all ${
                                    isTodayCell ? 'bg-blue-600 text-white shadow-md scale-110' : ''
                                  }`}
                                >
                                  <span
                                    className={`text-sm font-semibold leading-none ${
                                      !isTodayCell && (isGlobalHoliday ? 'text-red-500' : 'text-charcoal-700')
                                    }`}
                                  >
                                    {formatDate(day, 'd')}
                                  </span>
                                </div>
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {month.rows.map((row) => (
                        <PlannerRow
                          key={row.employee.id}
                          row={row}
                          projectMap={projectMap}
                          readOnly={readOnly}
                          draggedProjectId={draggedAssignment?.projectId}
                          draggedAssignmentId={draggedAssignment?.id}
                          onCellClick={handleCellClick}
                          onAddClick={handleAddClick}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          onDragOver={handleDragOver}
                          onDrop={handleDrop}
                          onRemoveAssignment={handleRemoveAssignment}
                          onNavigateToEmployee={onNavigateToEmployee}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <DayEditModal
        isOpen={!!selectedCell}
        selectedCell={selectedCell}
        employees={employees}
        projects={projects}
        assignments={assignments}
        absences={absences}
        readOnly={readOnly}
        onClose={() => setSelectedCell(null)}
        onSave={handleSaveFromModal}
        onDeleteAbsence={handleDeleteAbsenceFromModal}
      />

      {/* Legend Modal */}
      <Modal
        isOpen={showLegend}
        onClose={() => setShowLegend(false)}
        title={t('planner.legend')}
        size="sm"
      >
        <div className="space-y-1">
          {projects.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-charcoal-50 transition-colors"
            >
              <Folder
                className={`w-4 h-4 flex-shrink-0 ${
                  (PASTEL_VARIANTS[p.color] ?? PASTEL_VARIANTS.gray).text
                }`}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium text-charcoal-900">{p.name}</div>
                  {p.isCritical && <AlertCircle className="w-3 h-3 text-red-500" />}
                </div>
                <div className="text-xs text-charcoal-500">{p.client}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-end">
          <Button onClick={() => setShowLegend(false)}>{t('sidebar.close')}</Button>
        </div>
      </Modal>

      {/* AI Resource Chat */}
      <ResourcePlanChat
        employees={employees}
        projects={projects}
        assignments={assignments}
        absences={absences}
        currentDate={currentDate}
      />
    </div>
  );
};
