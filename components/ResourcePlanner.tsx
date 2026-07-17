
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  format, 
  eachDayOfInterval, 
  startOfMonth, 
  endOfMonth, 
  addMonths, 
  isWeekend, 
  isSameDay, 
  isToday,
  getISOWeek,
  startOfQuarter,
  addQuarters,
  getDay,
  isSameMonth,
  addDays
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, X, Info, FileSpreadsheet, Share2, Check, GripVertical, Repeat, ArrowRight, Lock, Search, Filter, Folder, AlertCircle, Sun, Umbrella, BookOpen, PartyPopper, Ban, Flag, ExternalLink, CalendarCheck, Zap, PieChart, Activity, Briefcase, Calendar, Clock, Trash2 } from 'lucide-react';
import { Employee, Project, Assignment, TimeScale, Absence } from '../types';
import { PASTEL_VARIANTS, MOCK_HOLIDAYS } from '../constants';
import { Button } from './ui/Button';
import { useLanguage } from '../contexts/LanguageContext';
import { Modal } from './ui/Modal';
import { ResourcePlanChat } from './ResourcePlanChat';

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

// Helper interface for local state in modal
interface DraftAssignment {
  projectId: string;
  allocation: number;
  assignmentId?: string; // If editing existing
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
  readOnly = false
}) => {
  const { t, formatDate } = useLanguage();
  const [currentDate, setCurrentDate] = useState(initialDate || new Date());
  const lastInitDateRef = useRef(initialDate ? initialDate.getTime() : 0);
  
  // View State
  const [timeScale, setTimeScale] = useState<TimeScale>(TimeScale.MONTH);
  const [showLegend, setShowLegend] = useState(false);
  const [activeProjectFilter, setActiveProjectFilter] = useState<string>('all');

  // Interaction State
  const [selectedCell, setSelectedCell] = useState<{empId: string, date: Date} | null>(null);

  // Modal State
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<'all' | 'active' | 'opportunity'>('all');
  const [tabMode, setTabMode] = useState<'project' | 'absence'>('project');
  const [absenceType, setAbsenceType] = useState<Absence['type']>('vacation');
  const [absenceDuration, setAbsenceDuration] = useState(1);
  
  // Granular Allocation State
  const [draftAssignments, setDraftAssignments] = useState<DraftAssignment[]>([]);

  // Bulk Assign / Repeat Mode state
  const [isRepeatMode, setIsRepeatMode] = useState(false);
  const [repeatDays, setRepeatDays] = useState<number[]>([]); // 0=Sun, 1=Mon...

  // Drag and Drop state
  const [draggingEmpId, setDraggingEmpId] = useState<string | null>(null);
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

  // When selected cell changes, initialize the buffer
  useEffect(() => {
    if (selectedCell) {
        const dateStr = format(selectedCell.date, 'yyyy-MM-dd');
        
        // Load Assignments into Draft State
        const existing = assignments
            .filter(a => a.employeeId === selectedCell.empId && a.date === dateStr)
            .map(a => ({
                projectId: a.projectId,
                allocation: a.allocation || 1,
                assignmentId: a.id
            }));
        
        setDraftAssignments(existing);
        
        // Reset defaults
        setIsRepeatMode(false);
        setRepeatDays([getDay(selectedCell.date)]);
        setProjectSearchQuery('');
        setProjectFilter('all');
        setTabMode('project');
        setAbsenceDuration(1);
    }
  }, [selectedCell, assignments]);

  // Calculate months to render based on timeScale
  const monthsToRender = useMemo(() => {
    if (timeScale === TimeScale.MONTH) {
        return [startOfMonth(currentDate)];
    } else {
        const start = startOfQuarter(currentDate);
        return [0, 1, 2].map(i => addMonths(start, i));
    }
  }, [currentDate, timeScale]);

  const headerTitle = useMemo(() => {
    if (timeScale === TimeScale.MONTH) {
      return formatDate(currentDate, 'MMMM yyyy');
    }
    const quarter = Math.floor(startOfQuarter(currentDate).getMonth() / 3) + 1;
    return `Q${quarter} ${formatDate(currentDate, 'yyyy')}`;
  }, [currentDate, timeScale, formatDate]);

  const handlePrev = () => {
    if (timeScale === TimeScale.QUARTER) {
      setCurrentDate(prev => addQuarters(prev, -1));
    } else {
      setCurrentDate(prev => addMonths(prev, -1));
    }
  };

  const handleNext = () => {
    if (timeScale === TimeScale.QUARTER) {
      setCurrentDate(prev => addQuarters(prev, 1));
    } else {
      setCurrentDate(prev => addMonths(prev, 1));
    }
  };

  const handleTodayJump = () => {
      setCurrentDate(new Date());
      // Wait for render cycle to update DOM if month changed
      setTimeout(() => {
        const el = document.getElementById('current-day-column');
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
      }, 100);
  };

  const getProject = (id: string) => projects.find(p => p.id === id);

  // Get active project details (for milestone display)
  const filteredProject = useMemo(() => 
    projects.find(p => p.id === activeProjectFilter),
  [activeProjectFilter, projects]);

  // --- Statistics Calculation for Any Month ---
  const getMonthStats = (monthStart: Date) => {
    const start = startOfMonth(monthStart);
    const end = endOfMonth(monthStart);
    const daysInMonth = eachDayOfInterval({ start, end });
    const monthStartStr = format(start, 'yyyy-MM-dd');
    const monthEndStr = format(end, 'yyyy-MM-dd');

    let totalCapacity = 0;
    let totalPlanned = 0;
    let overloadedDaysCount = 0;
    let workingDaysCount = 0; // Denominator for overload %
    const projectLoadMap = new Map<string, number>();

    // 1. Calculate Capacity & Working Days
    employees.forEach(emp => {
      daysInMonth.forEach(day => {
        if (isWeekend(day)) return;
        const dStr = format(day, 'yyyy-MM-dd');
        
        // Check holiday
        const isHoliday = MOCK_HOLIDAYS.some(h => h.date === dStr && (h.location === 'ALL' || h.location === emp.location));
        if (isHoliday) return;

        // Check Absence
        const isAbsent = absences.some(a => a.employeeId === emp.id && a.date === dStr);
        if (isAbsent) return;

        workingDaysCount++; // This is a valid working slot
        totalCapacity += (emp.availability / 100);

        // 2. Calculate Overload
        // Get assignments for this specific day/emp
        const dailyAssignments = assignments.filter(a => a.employeeId === emp.id && a.date === dStr);
        const dailyLoad = dailyAssignments.reduce((acc, a) => acc + (a.allocation || 1), 0);
        
        if (dailyLoad > 1.0) {
            overloadedDaysCount++;
        }
      });
    });

    // 3. Calculate Planned Total & Project Breakdown
    // We iterate assignments within range
    assignments.forEach(a => {
        if (a.date >= monthStartStr && a.date <= monthEndStr) {
             const val = a.allocation || 1;
             totalPlanned += val;
             
             const currentProjVal = projectLoadMap.get(a.projectId) || 0;
             projectLoadMap.set(a.projectId, currentProjVal + val);
        }
    });

    // Sort Projects
    const projectStats = Array.from(projectLoadMap.entries())
        .map(([id, val]) => ({ id, val, project: getProject(id) }))
        .filter(item => item.project) // Safety check
        .sort((a, b) => b.val - a.val)
        .slice(0, 3); // Top 3 only for compact view

    return {
        totalCapacity: Math.round(totalCapacity * 10) / 10,
        totalPlanned: Math.round(totalPlanned * 10) / 10,
        freeCapacity: Math.round((totalCapacity - totalPlanned) * 10) / 10,
        overloadedDaysCount: overloadedDaysCount,
        projectStats
    };
  };

  // --- Drag and Drop Logic ---
  const handleDragStart = (e: React.DragEvent, assignment: Assignment) => {
    if (readOnly) return;
    e.dataTransfer.setData('assignmentId', assignment.id);
    e.dataTransfer.setData('empId', assignment.employeeId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingEmpId(assignment.employeeId);
    setDraggingAssignmentId(assignment.id);
  };

  const handleDragEnd = () => {
    setDraggingEmpId(null);
    setDraggingAssignmentId(null);
  };

  const handleDragOver = (e: React.DragEvent, targetEmpId: string, targetDate: Date) => {
    if (readOnly) return;
    
    // Check for duplicates
    if (draggingAssignmentId) {
         const draggedAssignment = assignments.find(a => a.id === draggingAssignmentId);
         if (draggedAssignment) {
             const targetDateStr = format(targetDate, 'yyyy-MM-dd');
             
             // Check for Absence
             const hasAbsence = absences.some(a => 
                 a.employeeId === targetEmpId && 
                 a.date === targetDateStr
             );
             if (hasAbsence) {
                 e.dataTransfer.dropEffect = "none";
                 return;
             }

             // Check if target already has this project
             const hasProject = assignments.some(a => 
                 a.employeeId === targetEmpId && 
                 a.date === targetDateStr && 
                 a.projectId === draggedAssignment.projectId && 
                 a.id !== draggingAssignmentId
             );
             
             if (hasProject) {
                 e.dataTransfer.dropEffect = "none";
                 return;
             }
         }
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetEmpId: string, targetDate: Date) => {
    if (readOnly) return;
    e.preventDefault();
    setDraggingEmpId(null);
    setDraggingAssignmentId(null);
    
    const assignmentId = e.dataTransfer.getData('assignmentId');
    const targetDateStr = format(targetDate, 'yyyy-MM-dd');

    // Check for Absence
    const hasAbsence = absences.some(a => 
        a.employeeId === targetEmpId && 
        a.date === targetDateStr
    );
    if (hasAbsence) return;

    // Duplicate Check logic again to be safe
    const draggedAssignment = assignments.find(a => a.id === assignmentId);
    if (draggedAssignment) {
        const hasProject = assignments.some(a => 
            a.employeeId === targetEmpId && 
            a.date === targetDateStr && 
            a.projectId === draggedAssignment.projectId &&
            a.id !== assignmentId
        );
        if (hasProject) return;
    }

    const updatedAssignments = assignments.map(a => {
        if (a.id === assignmentId) {
            // Update assignment with new date AND new employeeId, keep allocation
            return { ...a, date: targetDateStr, employeeId: targetEmpId };
        }
        return a;
    });
    
    onAssignmentChange(updatedAssignments);
  };

  // --- Assignment Management ---
  const handleRemoveAssignment = (assignmentId: string) => {
    if (readOnly) return;
    const newAssignments = assignments.filter(a => a.id !== assignmentId);
    onAssignmentChange(newAssignments);
  };

  const handleRemoveAbsence = (absenceId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (readOnly) return;
      onAbsenceChange(absences.filter(a => a.id !== absenceId));
  };

  const handleSaveAssignments = () => {
      if (readOnly || !selectedCell) return;
      
      const targetDateStr = format(selectedCell.date, 'yyyy-MM-dd');
      let newAssignments = [...assignments];
      let newAbsences = [...absences];

      const daysToProcess: string[] = [];

      if (tabMode === 'project') {
          if (isRepeatMode) {
              const monthStart = startOfMonth(selectedCell.date);
              const monthEnd = endOfMonth(selectedCell.date);
              const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

              daysInMonth.forEach(d => {
                  if (repeatDays.includes(getDay(d))) {
                      daysToProcess.push(format(d, 'yyyy-MM-dd'));
                  }
              });
          } else {
              daysToProcess.push(targetDateStr);
          }
      } else if (tabMode === 'absence') {
          // Calculate consecutive working days
          let count = 0;
          let offset = 0;
          while (count < absenceDuration) {
              const d = addDays(selectedCell.date, offset);
              // Skip weekends for absences
              if (!isWeekend(d)) {
                   daysToProcess.push(format(d, 'yyyy-MM-dd'));
                   count++;
              }
              offset++;
          }
      }

      // Cleanup existing data for target days/employee
      newAssignments = newAssignments.filter(a => !(a.employeeId === selectedCell.empId && daysToProcess.includes(a.date)));
      newAbsences = newAbsences.filter(a => !(a.employeeId === selectedCell.empId && daysToProcess.includes(a.date)));

      daysToProcess.forEach(dateStr => {
          if (tabMode === 'project') {
             draftAssignments.forEach(draft => {
                 newAssignments.push({
                     id: Math.random().toString(36).substr(2, 9),
                     employeeId: selectedCell.empId,
                     projectId: draft.projectId,
                     date: dateStr,
                     allocation: draft.allocation
                 });
             });
          } else {
              // Add Absence
              newAbsences.push({
                  id: Math.random().toString(36).substr(2, 9),
                  employeeId: selectedCell.empId,
                  date: dateStr,
                  type: absenceType,
                  approved: true
              });
          }
      });

      onAssignmentChange(newAssignments);
      onAbsenceChange(newAbsences);
      setSelectedCell(null);
  };

  const toggleRepeatDay = (dayIndex: number) => {
      setRepeatDays(prev => {
          if (prev.includes(dayIndex)) return prev.filter(d => d !== dayIndex);
          return [...prev, dayIndex].sort();
      });
  };

  // --- Draft Assignment Helpers ---
  const addDraftProject = (projectId: string) => {
      if (draftAssignments.some(d => d.projectId === projectId)) return;
      
      const currentTotalAlloc = draftAssignments.reduce((acc, curr) => acc + curr.allocation, 0);
      const currentTotalHours = currentTotalAlloc * 8;
      const remainingHours = Math.max(0, 8 - currentTotalHours);
      
      // Default to remaining hours, or 1h if full/nearly full, rounded to 0.5
      let defaultHours = remainingHours > 0.5 ? remainingHours : 1;
      defaultHours = Math.round(defaultHours * 2) / 2; // Round to nearest 0.5

      setDraftAssignments([...draftAssignments, {
          projectId,
          allocation: defaultHours / 8
      }]);
  };

  const updateDraftHours = (projectId: string, hours: number) => {
      setDraftAssignments(prev => prev.map(d => 
          d.projectId === projectId ? { ...d, allocation: hours / 8 } : d
      ));
  };

  const removeDraftAssignment = (projectId: string) => {
      setDraftAssignments(prev => prev.filter(d => d.projectId !== projectId));
  };
  
  const toHours = (alloc: number) => Math.round(alloc * 8 * 10) / 10;

  const getDayLabel = (idx: number) => {
      const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return labels[idx];
  };

  // Get assignments for rendering, respecting the active filter
  const getCellData = (empId: string, date: Date) => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const employee = employees.find(e => e.id === empId);
      
      const absence = absences.find(a => a.employeeId === empId && a.date === dateStr);

      const holiday = MOCK_HOLIDAYS.find(h => 
          h.date === dateStr && (h.location === 'ALL' || h.location === employee?.location)
      );

      let cellAssignments = assignments.filter(a => a.employeeId === empId && a.date === dateStr);
      
      if (activeProjectFilter === 'status:active') {
         cellAssignments = cellAssignments.filter(a => {
             const p = getProject(a.projectId);
             return p && p.status === 'active';
         });
      } else if (activeProjectFilter === 'status:opportunity') {
         cellAssignments = cellAssignments.filter(a => {
             const p = getProject(a.projectId);
             return p && p.status === 'opportunity';
         });
      } else if (activeProjectFilter !== 'all') {
        cellAssignments = cellAssignments.filter(a => a.projectId === activeProjectFilter);
      }
      
      return { assignments: cellAssignments, absence, holiday };
  };

  // Stats Calculator - Heatmap Logic
  const getEmployeeStats = (emp: Employee, monthDays: Date[]) => {
      const monthStartStr = format(monthDays[0], 'yyyy-MM-dd');
      const monthEndStr = format(monthDays[monthDays.length - 1], 'yyyy-MM-dd');

      const workingDays = monthDays.filter(d => {
          if (isWeekend(d)) return false;
          const dStr = format(d, 'yyyy-MM-dd');
          const isHoliday = MOCK_HOLIDAYS.some(h => h.date === dStr && (h.location === 'ALL' || h.location === emp.location));
          return !isHoliday;
      });
      
      const empAbsences = absences.filter(a => 
         a.employeeId === emp.id && a.date >= monthStartStr && a.date <= monthEndStr
      );
      const validAbsences = empAbsences.filter(a => {
          const d = new Date(a.date);
          const dStr = format(d, 'yyyy-MM-dd');
          const isHoliday = MOCK_HOLIDAYS.some(h => h.date === dStr && (h.location === 'ALL' || h.location === emp.location));
          return !isWeekend(d) && !isHoliday;
      }).length;

      const effectiveWorkingDays = workingDays.length - validAbsences;
      const capacity = Math.round(effectiveWorkingDays * (emp.availability / 100) * 10) / 10;

      const empAssignments = assignments.filter(a => 
          a.employeeId === emp.id && 
          a.date >= monthStartStr && 
          a.date <= monthEndStr
      );
      
      const plannedLoad = empAssignments.reduce((acc, curr) => acc + (curr.allocation || 1), 0);
      
      const freeDays = Math.round((capacity - plannedLoad) * 10) / 10;
      const utilization = capacity > 0 ? Math.round((plannedLoad / capacity) * 100) : 0;

      return { capacity, plannedDays: Math.round(plannedLoad * 10) / 10, freeDays, utilization };
  };
  
  const draggedAssignment = useMemo(() => 
      draggingAssignmentId ? assignments.find(a => a.id === draggingAssignmentId) : null
  , [draggingAssignmentId, assignments]);

  const getDailyLoad = (empId: string, dateStr: string) => {
      const load = assignments
        .filter(a => a.employeeId === empId && a.date === dateStr)
        .reduce((sum, a) => sum + (a.allocation || 1), 0);
      return Math.round(load * 100) / 100;
  };

  const hasCriticalConflict = (assignments: Assignment[]) => {
      const criticalCount = assignments.reduce((count, a) => {
          const p = getProject(a.projectId);
          return p?.isCritical ? count + 1 : count;
      }, 0);
      return criticalCount > 1;
  };

  return (
    <div className="flex flex-col h-full bg-gray-50/50 relative">
      {/* Toolbar */}
      <div className="flex-none bg-white border-b border-charcoal-200 px-6 py-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-white rounded-md shadow-sm border border-charcoal-200 p-0.5">
            <button onClick={handlePrev} className="p-1.5 hover:bg-charcoal-100 rounded-md text-charcoal-500"><ChevronLeft className="w-5 h-5" /></button>
            <div className="px-4 font-semibold text-charcoal-800 min-w-[160px] text-center">{headerTitle}</div>
            <button onClick={handleNext} className="p-1.5 hover:bg-charcoal-100 rounded-md text-charcoal-500"><ChevronRight className="w-5 h-5" /></button>
          </div>
          
          <Button variant="ghost" size="sm" onClick={handleTodayJump} className="text-charcoal-600 border border-charcoal-200 hover:bg-charcoal-50">
              <CalendarCheck className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">{t('planner.today')}</span>
          </Button>

          {readOnly && (
            <div className="px-2 py-0.5 rounded text-xs font-bold bg-charcoal-100 text-charcoal-500 flex items-center gap-1 border border-charcoal-200">
                <Lock className="w-3 h-3" /> Read Only
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
            <Filter className="absolute left-2.5 w-4 h-4 text-charcoal-400 pointer-events-none" />
            <select
              value={activeProjectFilter}
              onChange={(e) => setActiveProjectFilter(e.target.value)}
              className="pl-9 pr-8 py-1.5 h-9 bg-white border border-charcoal-200 rounded-md text-sm font-medium text-charcoal-600 focus:outline-none focus:ring-2 focus:ring-charcoal-400 hover:bg-charcoal-50 appearance-none cursor-pointer min-w-[160px]"
            >
              <option value="all">{t('planner.allProjects')}</option>
              <option value="status:active">{t('planner.filterActive')}</option>
              <option value="status:opportunity">{t('planner.filterOpportunity')}</option>
              <optgroup label={t('projects.title')}>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
              </optgroup>
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none border-l-4 border-l-transparent border-r-4 border-r-transparent border-t-4 border-t-charcoal-400"></div>
          </div>

          <button onClick={() => setShowLegend(true)} className={`p-2 rounded-md transition-colors ${showLegend ? 'bg-blue-100 text-blue-700' : 'hover:bg-charcoal-100 text-charcoal-500'}`}>
            <Info className="w-5 h-5" />
          </button>
          <Button variant="outline" className="gap-2" size="sm">
            <Share2 className="w-4 h-4" />
            {t('planner.exportState')}
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <div className="flex flex-col gap-8 max-w-[100vw]">
          
          {monthsToRender.map(monthStart => {
             const daysInMonth = eachDayOfInterval({ start: startOfMonth(monthStart), end: endOfMonth(monthStart) });
             const isCurrentMonth = isSameMonth(monthStart, new Date());
             const monthStats = getMonthStats(monthStart);

             const weeks: { week: number, count: number }[] = [];
             daysInMonth.forEach(day => {
                const w = getISOWeek(day);
                if (weeks.length > 0 && weeks[weeks.length - 1].week === w) {
                    weeks[weeks.length - 1].count++;
                } else {
                    weeks.push({ week: w, count: 1 });
                }
             });

             return (
               <div key={monthStart.toISOString()} className="bg-white rounded-xl shadow-sm border border-charcoal-200 flex flex-col">
                  {/* Month Header */}
                  <div className="px-6 py-4 border-b border-charcoal-200 bg-charcoal-50 flex items-center justify-between gap-4 rounded-t-xl">
                     <div className="flex items-center">
                        <h3 className="text-lg font-bold text-charcoal-900 leading-none">{formatDate(monthStart, 'MMMM yyyy')}</h3>
                        
                        <div className="flex items-center gap-0.5 ml-1.5 relative -top-1.5 text-charcoal-400 select-none" title={`${daysInMonth.length} ${t('planner.days')}`}>
                            <Calendar className="w-2.5 h-2.5" />
                            <span className="text-[9px] font-bold leading-none">{daysInMonth.length}</span>
                        </div>

                        {isCurrentMonth && (
                            <span className="ml-3 text-[10px] font-bold text-blue-600 bg-white border border-blue-200 px-2 py-0.5 rounded-full uppercase tracking-wide">
                                {t('planner.current')}
                            </span>
                        )}
                     </div>
                     
                     <div className="flex items-center gap-4 text-xs hidden lg:flex">
                         {/* Stats Summary */}
                         <div className="flex items-center gap-1.5" title={`${t('planner.tooltipCapacity')}: ${monthStats.totalPlanned} / ${monthStats.totalCapacity}`}>
                            <Activity className="w-3.5 h-3.5 text-charcoal-400" />
                            <span className="font-bold text-charcoal-700">{Math.round((monthStats.totalPlanned / (monthStats.totalCapacity || 1)) * 100)}%</span>
                            <span className="text-charcoal-400">({monthStats.totalPlanned}/{monthStats.totalCapacity}d)</span>
                         </div>
                         
                         <div 
                            title={t('planner.tooltipFree')}
                            className={`font-medium px-2 py-0.5 rounded-md border ${monthStats.freeCapacity < 0 ? 'bg-red-50 text-red-700 border-red-100' : 'bg-green-50 text-green-700 border-green-100'}`}
                         >
                            {monthStats.freeCapacity > 0 ? '+' : ''}{monthStats.freeCapacity}d
                         </div>

                         {monthStats.overloadedDaysCount > 0 && (
                            <div className="flex items-center gap-1 text-red-600 font-bold bg-red-50 px-1.5 py-0.5 rounded-full border border-red-100" title={t('planner.tooltipOverload')}>
                                <Zap className="w-3 h-3 fill-red-100" />
                                {monthStats.overloadedDaysCount}d
                            </div>
                         )}

                         <div className="w-px h-4 bg-charcoal-200"></div>

                         <div className="flex items-center gap-2">
                            {monthStats.projectStats.map(item => (
                                <div key={item.id} className="flex items-center gap-1 px-1.5 py-0.5 bg-white border border-charcoal-200 rounded-full shadow-sm" title={`${item.project!.name} (${item.project!.client}): ${item.val}d`}>
                                    <div className={`w-1.5 h-1.5 rounded-full ${PASTEL_VARIANTS[item.project!.color].text.replace('text-', 'bg-')}`}></div>
                                    <span className="text-[10px] font-medium text-charcoal-600 max-w-[80px] truncate">{item.project!.name}</span>
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
                                <th className="sticky left-0 top-0 z-30 bg-charcoal-50 border-r border-charcoal-200 w-64 min-w-[280px] text-left px-4 shadow-[2px_0_5px_rgba(0,0,0,0.05)]" rowSpan={2}>
                                    <span className="text-xs font-semibold text-charcoal-500 uppercase tracking-wider">{t('planner.employee')}</span>
                                </th>
                                {weeks.map((week, idx) => (
                                    <th 
                                        key={`week-${week.week}-${idx}`} 
                                        colSpan={week.count} 
                                        className="sticky top-0 z-20 bg-charcoal-50/50 border-r border-charcoal-200 text-[10px] text-charcoal-500 font-medium text-center uppercase tracking-wider"
                                    >
                                        KW {week.week}
                                    </th>
                                ))}
                           </tr>
                           <tr className="h-10 border-b border-charcoal-200">
                              {daysInMonth.map(day => {
                                 const isWknd = isWeekend(day);
                                 const isMonday = getDay(day) === 1;
                                 const isTodayCell = isToday(day);
                                 const dateStr = format(day, 'yyyy-MM-dd');
                                 
                                 const isGlobalHoliday = MOCK_HOLIDAYS.some(h => h.date === dateStr && h.location === 'DE'); 
                                 const milestone = filteredProject?.milestones?.find(m => m.date === dateStr);

                                 return (
                                    <th 
                                      key={day.toISOString()}
                                      id={isTodayCell ? 'current-day-column' : undefined}
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
                                          <span className={`text-[9px] font-bold uppercase mb-0.5 ${isTodayCell ? 'text-blue-600' : isMonday ? 'text-blue-600' : isGlobalHoliday ? 'text-red-500' : 'text-charcoal-400'}`}>
                                            {formatDate(day, 'EEE')}
                                          </span>
                                          <div className={`flex items-center justify-center w-6 h-6 rounded-full transition-all ${isTodayCell ? 'bg-blue-600 text-white shadow-md scale-110' : ''}`}>
                                              <span className={`text-sm font-semibold leading-none ${!isTodayCell && (isGlobalHoliday ? 'text-red-500' : 'text-charcoal-700')}`}>
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
                           {employees.map(emp => {
                              const stats = getEmployeeStats(emp, daysInMonth);

                              return (
                              <tr key={emp.id} className="group hover:bg-charcoal-50/30 transition-colors border-b border-charcoal-100 last:border-0">
                                 <td 
                                    className="sticky left-0 z-10 bg-white group-hover:bg-charcoal-50/30 border-r border-charcoal-200 p-3 shadow-[2px_0_5px_rgba(0,0,0,0.05)] cursor-pointer hover:bg-blue-50/20 align-top"
                                    onClick={() => onNavigateToEmployee && onNavigateToEmployee(emp.id)}
                                    title="View Employee Overview"
                                 >
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-3">
                                            <img src={emp.avatar} alt={emp.name} className="w-9 h-9 rounded-full border border-charcoal-100" />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1 group-hover:text-blue-600 transition-colors">
                                                    <div className="text-sm font-bold text-charcoal-900 truncate">{emp.name}</div>
                                                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-50" />
                                                </div>
                                                <div className="text-xs text-charcoal-500 truncate flex items-center gap-1">
                                                    {emp.role} • <span className="uppercase">{emp.location}</span>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div className="flex items-center justify-between pt-2 px-0.5 mt-1 border-t border-charcoal-100">
                                            <div className="flex items-baseline gap-2 text-xs">
                                                <span className="text-charcoal-600" title={t('planner.plannedCapacity')}>
                                                    <span className="font-semibold text-charcoal-900">{stats.plannedDays}</span> / {stats.capacity}d
                                                </span>
                                                <span 
                                                    className={`text-[10px] ml-1.5 font-medium px-1 rounded ${stats.freeDays < 0 ? 'text-red-600 bg-red-50' : 'text-charcoal-400'}`} 
                                                    title={t('planner.freeDays')}
                                                >
                                                    {stats.freeDays > 0 ? `+${stats.freeDays}` : stats.freeDays}
                                                </span>
                                            </div>
                                            
                                            <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold border min-w-[36px] text-center ${
                                                stats.utilization > 100 ? 'bg-red-100 text-red-800 border-red-200' : // Overload
                                                stats.utilization >= 80 ? 'bg-green-50 text-green-700 border-green-100' : // Good
                                                stats.utilization >= 50 ? 'bg-blue-50 text-blue-700 border-blue-100' : // OK
                                                'bg-yellow-50 text-yellow-700 border-yellow-200' // Underutilized
                                            }`} title={`${stats.utilization}%`}>
                                                {stats.utilization}%
                                            </div>
                                        </div>
                                    </div>
                                 </td>
                                 {daysInMonth.map(day => {
                                    const { assignments: dayAssignments, absence, holiday } = getCellData(emp.id, day);
                                    const isWknd = isWeekend(day);
                                    const isMonday = getDay(day) === 1;
                                    const isTodayCell = isToday(day);
                                    const isInteractive = !readOnly && !isWknd && !holiday;
                                    
                                    const dailyLoad = getDailyLoad(emp.id, format(day, 'yyyy-MM-dd'));
                                    const isOverloaded = dailyLoad > 1.0;
                                    const conflict = hasCriticalConflict(dayAssignments);

                                    const isDuplicateDrop = (!draggedAssignment || !isInteractive) ? false : dayAssignments.some(a => 
                                        a.projectId === draggedAssignment.projectId && 
                                        a.id !== draggedAssignment.id
                                    );

                                    return (
                                       <td 
                                          key={day.toISOString()}
                                          onDragOver={(e) => isInteractive && handleDragOver(e, emp.id, day)}
                                          onDrop={(e) => isInteractive && handleDrop(e, emp.id, day)}
                                          onClick={() => isInteractive && setSelectedCell({ empId: emp.id, date: day })}
                                          className={`
                                             border-r border-charcoal-100 p-1 relative min-h-[7rem] h-auto align-top transition-all group/cell
                                             ${holiday 
                                                ? 'bg-red-50/30 cursor-not-allowed pattern-diagonal-lines-sm text-red-800' // Holiday
                                                : absence 
                                                    ? 'bg-stripes-gray cursor-not-allowed opacity-80' 
                                                    : isTodayCell
                                                        ? 'bg-blue-50/40 border-x-2 border-x-blue-200/50' 
                                                    : isWknd 
                                                        ? 'bg-charcoal-50/50 cursor-not-allowed' 
                                                        : isOverloaded 
                                                            ? 'bg-red-50 hover:bg-red-100/50 cursor-pointer' 
                                                            : 'bg-white cursor-pointer hover:bg-blue-50/30'
                                              }
                                             ${isDuplicateDrop ? 'bg-red-50/40 cursor-not-allowed ring-inset ring-2 ring-red-100' : ''}
                                             ${isMonday ? 'border-l border-l-charcoal-200' : ''}
                                          `}
                                          style={absence ? { backgroundImage: 'repeating-linear-gradient(45deg, #f9fafb 25%, transparent 25%, transparent 50%, #f9fafb 50%, #f9fafb 75%, transparent 75%, transparent)', backgroundSize: '10px 10px' } : {}}
                                       >
                                          <div className="absolute top-0.5 right-0.5 z-10 flex gap-0.5 justify-end">
                                              {conflict && !holiday && (
                                                  <div title={t('planner.criticalConflict')}>
                                                      <AlertCircle className="w-3 h-3 text-red-600 fill-white" />
                                                  </div>
                                              )}
                                              {isOverloaded && !holiday && !absence && (
                                                  <div title={t('planner.overload')} className="bg-red-100 rounded-full p-0.5 border border-red-200 shadow-sm">
                                                      <Zap className="w-2.5 h-2.5 text-red-600 fill-red-100" />
                                                  </div>
                                              )}
                                          </div>

                                          <div className="flex flex-col gap-1 pb-6">
                                             {holiday && (
                                                 <div className="w-full h-full flex flex-col items-center justify-center text-center opacity-60">
                                                     <PartyPopper className="w-4 h-4 text-red-400 mb-1" />
                                                     <span className="text-[9px] font-bold text-red-400 uppercase leading-tight px-1 break-words w-full">{holiday.name}</span>
                                                 </div>
                                             )}

                                             {absence && !holiday && (
                                                 <div className="w-full h-full flex items-center justify-center relative group/absence">
                                                     <div className="text-xs font-semibold text-charcoal-400 rotate-45 flex flex-col items-center bg-white/50 p-1 rounded backdrop-blur-[1px] shadow-sm">
                                                         {absence.type === 'vacation' && <Sun className="w-4 h-4 mb-0.5 text-yellow-500" />}
                                                         {absence.type === 'sick' && <Umbrella className="w-4 h-4 mb-0.5 text-red-500" />}
                                                         {absence.type === 'training' && <BookOpen className="w-4 h-4 mb-0.5 text-blue-500" />}
                                                         <span className="text-[8px] uppercase">{t(`planner.${absence.type}`)}</span>
                                                     </div>
                                                     {isInteractive && (
                                                        <button
                                                            onClick={(e) => handleRemoveAbsence(absence.id, e)}
                                                            className="absolute top-0 right-0 opacity-0 group-hover/absence:opacity-100 p-1 text-charcoal-400 hover:text-red-600 bg-white/80 rounded"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                     )}
                                                 </div>
                                             )}

                                             {!absence && !holiday && dayAssignments.map(a => {
                                                const proj = getProject(a.projectId);
                                                if (!proj) return null;
                                                
                                                const allocation = a.allocation || 1;
                                                const hours = allocation * 8;
                                                const formattedHours = hours % 1 === 0 ? hours : hours.toFixed(1).replace(/\.0$/, '');
                                                // Only hide hours if it's the only assignment AND it's exactly 8 hours
                                                const showHours = !(dayAssignments.length === 1 && hours === 8);

                                                return (
                                                   <div 
                                                      key={a.id}
                                                      draggable={!readOnly}
                                                      onDragStart={(e) => !readOnly && handleDragStart(e, a)}
                                                      onDragEnd={handleDragEnd}
                                                      className={`
                                                         text-[9px] pl-1 pr-0.5 py-0.5 rounded border shadow-sm select-none
                                                         ${PASTEL_VARIANTS[proj.color].bg} ${PASTEL_VARIANTS[proj.color].text} ${PASTEL_VARIANTS[proj.color].border}
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
                                                              onClick={(e) => {
                                                                  e.stopPropagation();
                                                                  e.preventDefault();
                                                                  handleRemoveAssignment(a.id);
                                                              }}
                                                              className="opacity-0 group-hover/cell:opacity-100 hover:bg-black/10 p-0.5 rounded transition-opacity flex-shrink-0 ml-1"
                                                              title="Remove"
                                                          >
                                                              <X className="w-2.5 h-2.5" />
                                                          </button>
                                                      )}
                                                   </div>
                                                );
                                             })}
                                          </div>
                                          
                                          {isInteractive && !isDuplicateDrop && !absence && !holiday && (
                                              <div className="absolute bottom-1 left-1 right-1 opacity-0 group-hover/cell:opacity-100 transition-all duration-200 z-10 translate-y-2 group-hover/cell:translate-y-0">
                                                  <button 
                                                      onClick={(e) => {
                                                          e.stopPropagation();
                                                          setSelectedCell({ empId: emp.id, date: day });
                                                      }}
                                                      className="w-full h-5 bg-white/90 hover:bg-blue-50 border border-charcoal-200 hover:border-blue-200 text-charcoal-400 hover:text-blue-600 rounded flex items-center justify-center shadow-sm backdrop-blur-sm transition-colors"
                                                      title={t('planner.oneClickAssign')}
                                                  >
                                                      <Plus className="w-3.5 h-3.5" />
                                                  </button>
                                              </div>
                                          )}
                                               </td>
                                    );
                                 })}
                              </tr>
                           )})}
                        </tbody>
                     </table>
                  </div>
               </div>
             );
          })}
        </div>
      </div>

      {/* Improved Assignment Modal */}
      <Modal 
        isOpen={!!selectedCell} 
        onClose={() => setSelectedCell(null)} 
        title={selectedCell ? `${t('planner.oneClickAssign')} - ${formatDate(selectedCell.date, 'EEE, dd. MMMM')}` : ''}
      >
        <div className="space-y-5">
            {/* Tab Switcher */}
            <div className="flex bg-charcoal-100 p-1 rounded-lg">
                <button 
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${tabMode === 'project' ? 'bg-white text-charcoal-900 shadow-sm' : 'text-charcoal-500 hover:text-charcoal-700'}`}
                    onClick={() => setTabMode('project')}
                >
                    {t('planner.assignProject')}
                </button>
                <button 
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${tabMode === 'absence' ? 'bg-white text-charcoal-900 shadow-sm' : 'text-charcoal-500 hover:text-charcoal-700'}`}
                    onClick={() => setTabMode('absence')}
                >
                    {t('planner.markAbsence')}
                </button>
            </div>

            {/* Common Header: Employee Info & Repeat Mode */}
            <div className="bg-charcoal-50 p-4 rounded-lg border border-charcoal-100">
                <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-charcoal-700">{t('planner.employee')}</span>
                    {selectedCell && (
                        <div className="flex items-center gap-2">
                             <img src={employees.find(e => e.id === selectedCell.empId)?.avatar} className="w-6 h-6 rounded-full" />
                             <span className="text-sm text-charcoal-900">{employees.find(e => e.id === selectedCell.empId)?.name}</span>
                        </div>
                    )}
                </div>
                
                {tabMode === 'project' && (
                    <>
                    <div className="flex items-center gap-2 pt-3 border-t border-charcoal-200">
                        <input 
                            type="checkbox" 
                            id="repeatMode" 
                            checked={isRepeatMode} 
                            onChange={(e) => setIsRepeatMode(e.target.checked)} 
                            className="rounded border-charcoal-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                        <label htmlFor="repeatMode" className="text-sm text-charcoal-700 select-none flex items-center gap-2 cursor-pointer">
                            <Repeat className="w-4 h-4 text-charcoal-500" />
                            {t('planner.repeatMode')}
                        </label>
                    </div>

                    {isRepeatMode && (
                        <div className="mt-3 pl-6">
                            <div className="text-xs text-charcoal-500 mb-2 uppercase tracking-wide">{t('planner.applyOnDays')}:</div>
                            <div className="flex gap-2">
                                {[1, 2, 3, 4, 5].map(dayIdx => (
                                    <button
                                        key={dayIdx}
                                        onClick={() => toggleRepeatDay(dayIdx)}
                                        className={`w-8 h-8 rounded text-xs font-bold transition-colors ${
                                            repeatDays.includes(dayIdx) 
                                            ? 'bg-blue-600 text-white shadow-sm' 
                                            : 'bg-white border border-charcoal-200 text-charcoal-500 hover:bg-charcoal-100'
                                        }`}
                                    >
                                        {getDayLabel(dayIdx)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    </>
                )}

                {tabMode === 'absence' && (
                    <div className="flex items-center justify-between pt-3 border-t border-charcoal-200">
                        <label className="text-sm text-charcoal-700 flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-charcoal-500" />
                            Days count:
                        </label>
                        <div className="flex items-center gap-1">
                            <button 
                                onClick={() => setAbsenceDuration(Math.max(1, absenceDuration - 1))}
                                className="w-8 h-8 flex items-center justify-center rounded-l border border-charcoal-200 bg-white hover:bg-charcoal-50 text-charcoal-600"
                            >
                                -
                            </button>
                            <input 
                                type="number" 
                                className="w-12 h-8 text-center border-y border-charcoal-200 text-sm font-semibold focus:outline-none"
                                value={absenceDuration}
                                onChange={(e) => setAbsenceDuration(Math.max(1, parseInt(e.target.value) || 1))}
                            />
                            <button 
                                onClick={() => setAbsenceDuration(absenceDuration + 1)}
                                className="w-8 h-8 flex items-center justify-center rounded-r border border-charcoal-200 bg-white hover:bg-charcoal-50 text-charcoal-600"
                            >
                                +
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Project Management Mode */}
            {tabMode === 'project' && (
                <>
                {/* 1. Daily Schedule List with Sliders */}
                <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-charcoal-500 flex items-center gap-1.5 uppercase tracking-wider">
                        <Clock className="w-3 h-3" /> Daily Schedule
                    </h4>
                    
                    {draftAssignments.length > 0 ? (
                        <div className="space-y-3">
                             {/* Items Grid */}
                             <div className={`grid ${draftAssignments.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                                 {draftAssignments.map(draft => {
                                     const proj = getProject(draft.projectId);
                                     if (!proj) return null;
                                     const hours = Math.round(draft.allocation * 8 * 10) / 10;
                                     
                                     return (
                                         <div key={draft.projectId} className={`relative p-2.5 rounded-lg border flex flex-col gap-2 transition-all bg-white shadow-sm hover:shadow-md ${PASTEL_VARIANTS[proj.color].border}`}>
                                             {/* Header */}
                                             <div className="flex justify-between items-start gap-2">
                                                 <div className="min-w-0 flex items-center gap-2">
                                                      <div className={`w-2 h-2 rounded-full ${PASTEL_VARIANTS[proj.color].bg} ring-1 ring-inset ring-black/5`} />
                                                      <div className="truncate">
                                                         <div className="text-xs font-bold text-charcoal-900 truncate leading-none">{proj.name}</div>
                                                         <div className="text-[10px] text-charcoal-500 truncate leading-tight mt-0.5">{proj.client}</div>
                                                      </div>
                                                 </div>
                                                 <button 
                                                    onClick={() => removeDraftAssignment(draft.projectId)}
                                                    className="text-charcoal-300 hover:text-red-500 transition-colors -mt-0.5 -mr-0.5 p-0.5"
                                                    title="Remove"
                                                 >
                                                    <X className="w-3.5 h-3.5" />
                                                 </button>
                                             </div>
                                             
                                             {/* Input Area */}
                                             <div className="flex items-center gap-2">
                                                  <input 
                                                      type="range" 
                                                      min="0.5" 
                                                      max="10" 
                                                      step="0.5" 
                                                      value={hours}
                                                      onChange={(e) => updateDraftHours(draft.projectId, parseFloat(e.target.value))}
                                                      className="flex-1 h-1.5 bg-charcoal-100 rounded-lg appearance-none cursor-pointer accent-charcoal-700"
                                                  />
                                                  <div className="w-12 text-right">
                                                      <div className="flex items-center justify-end bg-charcoal-50 rounded border border-charcoal-100 px-1 py-0.5">
                                                          <span className="text-xs font-bold text-charcoal-800">{hours}</span>
                                                          <span className="text-[10px] text-charcoal-400 font-medium ml-0.5">h</span>
                                                      </div>
                                                  </div>
                                             </div>
                                         </div>
                                     );
                                 })}
                             </div>
                             
                             {/* Capacity Bar */}
                             {(() => {
                                 const totalAlloc = draftAssignments.reduce((acc, curr) => acc + curr.allocation, 0);
                                 const totalHours = Math.round(totalAlloc * 8 * 10) / 10;
                                 const isOver = totalHours > 8;
                                 return (
                                     <div className="bg-charcoal-50 p-3 rounded-lg border border-charcoal-100 flex items-center gap-4">
                                         <span className="text-[10px] font-bold text-charcoal-500 uppercase tracking-wider w-12">Total</span>
                                         <div className="flex-1 h-2.5 bg-charcoal-200 rounded-full overflow-hidden relative">
                                             <div 
                                                 className={`absolute top-0 left-0 h-full transition-all duration-300 ${isOver ? 'bg-red-500' : 'bg-green-500'}`} 
                                                 style={{ width: `${Math.min((totalHours / 8) * 100, 100)}%` }}
                                             />
                                         </div>
                                         <div className={`font-mono font-bold text-xs whitespace-nowrap ${isOver ? 'text-red-600' : 'text-charcoal-700'}`}>
                                             {totalHours}h <span className="text-charcoal-400 font-normal">/ 8h</span>
                                         </div>
                                     </div>
                                 );
                             })()}
                        </div>
                    ) : (
                        <div className="text-xs text-charcoal-400 italic text-center py-6 border border-dashed border-charcoal-200 rounded-lg bg-charcoal-50/50">
                            No projects assigned. Select below to add.
                        </div>
                    )}
                </div>

                {/* 2. Add New Project Section */}
                <div className="border-t border-charcoal-100 pt-4">
                    <h4 className="text-sm font-medium text-charcoal-900 mb-3">{t('planner.selectProjects')}</h4>
                    
                    {/* Search & Filter */}
                    <div className="mb-3 space-y-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 w-4 h-4 text-charcoal-400" />
                            <input 
                                type="text" 
                                placeholder={t('planner.searchProjects')} 
                                value={projectSearchQuery}
                                onChange={(e) => setProjectSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                            />
                        </div>
                        <div className="flex gap-2">
                            <button 
                                onClick={() => setProjectFilter('all')}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${projectFilter === 'all' ? 'bg-charcoal-800 text-white border-charcoal-800' : 'bg-white text-charcoal-600 border-charcoal-200 hover:bg-charcoal-50'}`}
                            >
                                {t('planner.all')}
                            </button>
                            <button 
                                onClick={() => setProjectFilter('active')}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${projectFilter === 'active' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-charcoal-600 border-charcoal-200 hover:bg-charcoal-50'}`}
                            >
                                {t('status.active')}
                            </button>
                            <button 
                                onClick={() => setProjectFilter('opportunity')}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${projectFilter === 'opportunity' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-charcoal-600 border-charcoal-200 hover:bg-charcoal-50'}`}
                            >
                                {t('status.opportunity')}
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-y-auto custom-scrollbar p-1">
                        {projects.filter(p => {
                            if (p.status !== 'active' && p.status !== 'opportunity') return false;
                            if (projectFilter !== 'all' && p.status !== projectFilter) return false;
                            if (projectSearchQuery) {
                                const q = projectSearchQuery.toLowerCase();
                                return p.name.toLowerCase().includes(q) || p.client.toLowerCase().includes(q);
                            }
                            return true;
                        }).map(project => {
                            const isAdded = draftAssignments.some(d => d.projectId === project.id);
                            return (
                                <button 
                                    key={project.id}
                                    onClick={() => addDraftProject(project.id)}
                                    disabled={isAdded}
                                    className={`
                                        flex items-center gap-3 p-3 rounded-lg border text-left transition-all
                                        ${isAdded 
                                            ? 'bg-charcoal-50 border-charcoal-100 opacity-50 cursor-default' 
                                            : 'bg-white border-charcoal-200 hover:border-blue-300 hover:bg-blue-50/30 cursor-pointer'}
                                        ${project.isCritical ? 'border-l-4 border-l-red-400' : ''}
                                    `}
                                >
                                    <Folder className={`w-4 h-4 flex-shrink-0 ${PASTEL_VARIANTS[project.color].text}`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-charcoal-900 truncate">{project.name}</span>
                                            {project.isCritical && <AlertCircle className="w-3 h-3 text-red-500" />}
                                        </div>
                                        <div className="text-xs text-charcoal-500 truncate">{project.client}</div>
                                    </div>
                                    {isAdded && <Check className="w-4 h-4 text-green-600" />}
                                    {!isAdded && <Plus className="w-4 h-4 text-charcoal-400" />}
                                </button>
                            );
                        })}
                    </div>
                </div>
                </>
            )}

            {tabMode === 'absence' && (
                <div className="grid grid-cols-3 gap-3">
                    <button
                        onClick={() => setAbsenceType('vacation')}
                        className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${absenceType === 'vacation' ? 'border-yellow-400 bg-yellow-50 text-yellow-700' : 'border-charcoal-100 bg-white text-charcoal-500 hover:border-charcoal-300'}`}
                    >
                        <Sun className="w-6 h-6" />
                        <span className="text-sm font-medium">{t('planner.vacation')}</span>
                    </button>
                    <button
                        onClick={() => setAbsenceType('sick')}
                        className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${absenceType === 'sick' ? 'border-red-400 bg-red-50 text-red-700' : 'border-charcoal-100 bg-white text-charcoal-500 hover:border-charcoal-300'}`}
                    >
                        <Umbrella className="w-6 h-6" />
                        <span className="text-sm font-medium">{t('planner.sick')}</span>
                    </button>
                    <button
                        onClick={() => setAbsenceType('training')}
                        className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${absenceType === 'training' ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-charcoal-100 bg-white text-charcoal-500 hover:border-charcoal-300'}`}
                    >
                        <BookOpen className="w-6 h-6" />
                        <span className="text-sm font-medium">{t('planner.training')}</span>
                    </button>
                </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-charcoal-100">
                <Button variant="ghost" onClick={() => setSelectedCell(null)}>{t('planner.cancel')}</Button>
                {(!isRepeatMode || tabMode === 'absence' || draftAssignments.length > 0) && <Button onClick={handleSaveAssignments}>{t('planner.save')}</Button>}
            </div>
        </div>
      </Modal>

      {/* Legend Modal */}
      <Modal 
        isOpen={showLegend} 
        onClose={() => setShowLegend(false)} 
        title={t('planner.legend')}
        size="sm"
      >
        <div className="space-y-1">
            {projects.map(p => (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-charcoal-50 transition-colors">
                    <Folder className={`w-4 h-4 flex-shrink-0 ${PASTEL_VARIANTS[p.color].text}`} />
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
