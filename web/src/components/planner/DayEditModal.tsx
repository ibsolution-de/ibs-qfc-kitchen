import React, { useEffect, useMemo, useState } from 'react';
import { format, getDay } from 'date-fns';
import {
  X,
  Repeat,
  Lock,
  Search,
  Folder,
  Check,
  Plus,
  AlertCircle,
  Calendar,
  Clock,
  Trash2,
  Sun,
  Umbrella,
  BookOpen,
} from 'lucide-react';
import type { Employee, Project, Assignment, Absence } from '../../types';
import { PASTEL_VARIANTS } from '../../constants';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useLanguage } from '../../contexts/LanguageContext';
import {
  computeTargetDates,
  mergeDayEntries,
  allocationToHours,
  DraftAssignment,
} from '../../utils/planner';

export interface DayEditModalProps {
  isOpen: boolean;
  selectedCell: { empId: string; date: Date } | null;
  employees: Employee[];
  projects: Project[];
  assignments: Assignment[];
  absences: Absence[];
  readOnly: boolean;
  onClose: () => void;
  onSave: (assignments: Assignment[], absences: Absence[]) => void;
  onDeleteAbsence: (employeeId: string, dateStr: string) => void;
}

type ProjectFilter = 'all' | 'active' | 'opportunity';

export const DayEditModal = React.memo<DayEditModalProps>(function DayEditModal({
  isOpen,
  selectedCell,
  employees,
  projects,
  assignments,
  absences,
  readOnly,
  onClose,
  onSave,
  onDeleteAbsence,
}) {
  const { t } = useLanguage();

  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('all');
  const [tabMode, setTabMode] = useState<'project' | 'absence'>('project');
  const [absenceType, setAbsenceType] = useState<Absence['type']>('vacation');
  const [absenceDuration, setAbsenceDuration] = useState(1);
  const [draftAssignments, setDraftAssignments] = useState<DraftAssignment[]>([]);
  const [isRepeatMode, setIsRepeatMode] = useState(false);
  const [repeatDays, setRepeatDays] = useState<number[]>([]);

  // Initialize / reset modal state when the selected cell changes
  useEffect(() => {
    if (selectedCell) {
      const dateStr = format(selectedCell.date, 'yyyy-MM-dd');

      const existing = assignments
        .filter((a) => a.employeeId === selectedCell.empId && a.date === dateStr)
        .map((a) => ({
          projectId: a.projectId,
          allocation: Math.min(a.allocation || 1, 1),
          assignmentId: a.id,
        }));

      setDraftAssignments(existing);
      setIsRepeatMode(false);
      setRepeatDays([getDay(selectedCell.date)]);
      setProjectSearchQuery('');
      setProjectFilter('all');
      setTabMode('project');
      setAbsenceDuration(1);
    }
  }, [selectedCell, assignments]);

  const selectedCellAbsence = useMemo(() => {
    if (!selectedCell) return null;
    const dateStr = format(selectedCell.date, 'yyyy-MM-dd');
    return absences.find((a) => a.employeeId === selectedCell.empId && a.date === dateStr) || null;
  }, [selectedCell, absences]);

  const selectedCellReadOnly = readOnly || !!selectedCellAbsence;
  const selectedEmployee = selectedCell
    ? employees.find((e) => e.id === selectedCell.empId)
    : undefined;

  const targetDates = useMemo(() => {
    if (!selectedCell) return [];
    return computeTargetDates({
      baseDate: selectedCell.date,
      mode: tabMode,
      isRepeat: tabMode === 'project' ? isRepeatMode : undefined,
      repeatDays: tabMode === 'project' ? repeatDays : undefined,
      absenceDuration: tabMode === 'absence' ? absenceDuration : undefined,
    });
  }, [selectedCell, tabMode, isRepeatMode, repeatDays, absenceDuration]);

  const hasConflict = useMemo(() => {
    if (!selectedCell || selectedCellReadOnly || targetDates.length === 0) return false;
    if (tabMode === 'project') {
      return targetDates.some((date) =>
        absences.some((a) => a.employeeId === selectedCell.empId && a.date === date)
      );
    }
    return targetDates.some((date) =>
      assignments.some((a) => a.employeeId === selectedCell.empId && a.date === date)
    );
  }, [targetDates, selectedCell, tabMode, absences, assignments, selectedCellReadOnly]);

  const handleSave = () => {
    if (!selectedCell || selectedCellReadOnly) return;

    const daysToProcess = computeTargetDates({
      baseDate: selectedCell.date,
      mode: tabMode,
      isRepeat: tabMode === 'project' ? isRepeatMode : undefined,
      repeatDays: tabMode === 'project' ? repeatDays : undefined,
      absenceDuration: tabMode === 'absence' ? absenceDuration : undefined,
    });

    const { assignments: newAssignments, absences: newAbsences } = mergeDayEntries({
      assignments,
      absences,
      draftAssignments,
      draftAbsence: tabMode === 'absence' ? { type: absenceType, approved: true } : null,
      employeeId: selectedCell.empId,
      dates: daysToProcess,
      mode: tabMode,
    });

    onSave(newAssignments, newAbsences);
  };

  const handleDeleteAbsence = () => {
    if (!selectedCell || !selectedCellAbsence) return;
    const dateStr = format(selectedCell.date, 'yyyy-MM-dd');
    onDeleteAbsence(selectedCell.empId, dateStr);
  };

  const addDraftProject = (projectId: string) => {
    if (draftAssignments.some((d) => d.projectId === projectId)) return;

    const currentTotalAlloc = draftAssignments.reduce((acc, curr) => acc + curr.allocation, 0);
    const currentTotalHours = currentTotalAlloc * 8;
    const remainingHours = Math.max(0, 8 - currentTotalHours);

    let defaultHours = remainingHours > 0.5 ? remainingHours : 1;
    defaultHours = Math.round(defaultHours * 2) / 2;

    setDraftAssignments((prev) => [
      ...prev,
      {
        projectId,
        allocation: defaultHours / 8,
      },
    ]);
  };

  const updateDraftHours = (projectId: string, hours: number) => {
    setDraftAssignments((prev) =>
      prev.map((d) => (d.projectId === projectId ? { ...d, allocation: hours / 8 } : d))
    );
  };

  const removeDraftAssignment = (projectId: string) => {
    setDraftAssignments((prev) => prev.filter((d) => d.projectId !== projectId));
  };

  const toggleRepeatDay = (dayIndex: number) => {
    setRepeatDays((prev) => {
      if (prev.includes(dayIndex)) return prev.filter((d) => d !== dayIndex);
      return [...prev, dayIndex].sort();
    });
  };

  const getDayLabel = (idx: number) => {
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return labels[idx];
  };

  const getProject = (id: string) => projects.find((p) => p.id === id);

  const title = selectedCell
    ? `${t('planner.oneClickAssign')} - ${format(selectedCell.date, 'EEE, dd. MMMM')}`
    : '';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-5">
        <div className="flex bg-charcoal-100 p-1 rounded-lg">
          <button
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tabMode === 'project'
                ? 'bg-white text-charcoal-900 shadow-sm'
                : 'text-charcoal-500 hover:text-charcoal-700'
            }`}
            onClick={() => setTabMode('project')}
          >
            {t('planner.assignProject')}
          </button>
          <button
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tabMode === 'absence'
                ? 'bg-white text-charcoal-900 shadow-sm'
                : 'text-charcoal-500 hover:text-charcoal-700'
            }`}
            onClick={() => setTabMode('absence')}
          >
            {t('planner.markAbsence')}
          </button>
        </div>

        <div className="bg-charcoal-50 p-4 rounded-lg border border-charcoal-100">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-charcoal-700">{t('planner.employee')}</span>
            {selectedEmployee && (
              <div className="flex items-center gap-2">
                <img src={selectedEmployee.avatar} className="w-6 h-6 rounded-full" />
                <span className="text-sm text-charcoal-900">{selectedEmployee.name}</span>
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
                  disabled={selectedCellReadOnly}
                  onChange={(e) => setIsRepeatMode(e.target.checked)}
                  className={`rounded border-charcoal-300 text-blue-600 focus:ring-blue-500 ${
                    selectedCellReadOnly ? 'cursor-not-allowed' : 'cursor-pointer'
                  }`}
                />
                <label
                  htmlFor="repeatMode"
                  className={`text-sm text-charcoal-700 select-none flex items-center gap-2 ${
                    selectedCellReadOnly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                  }`}
                >
                  <Repeat className="w-4 h-4 text-charcoal-500" />
                  {t('planner.repeatMode')}
                </label>
              </div>

              {isRepeatMode && (
                <div className="mt-3 pl-6">
                  <div className="text-xs text-charcoal-500 mb-2 uppercase tracking-wide">
                    {t('planner.applyOnDays')}:
                  </div>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((dayIdx) => (
                      <button
                        key={dayIdx}
                        onClick={() => toggleRepeatDay(dayIdx)}
                        disabled={selectedCellReadOnly}
                        className={`w-8 h-8 rounded text-xs font-bold transition-colors ${
                          repeatDays.includes(dayIdx)
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-white border border-charcoal-200 text-charcoal-500 hover:bg-charcoal-100'
                        } ${selectedCellReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
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
                {t('planner.daysCount')}
              </label>
              <div className="flex items-center gap-1">
                <button
                  onClick={() =>
                    setAbsenceDuration(Math.max(1, Math.min(60, absenceDuration - 1)))
                  }
                  disabled={selectedCellReadOnly}
                  className={`w-8 h-8 flex items-center justify-center rounded-l border border-charcoal-200 bg-white text-charcoal-600 ${
                    selectedCellReadOnly ? 'opacity-50 cursor-not-allowed' : 'hover:bg-charcoal-50'
                  }`}
                >
                  -
                </button>
                <input
                  type="number"
                  className="w-12 h-8 text-center border-y border-charcoal-200 text-sm font-semibold focus:outline-none disabled:opacity-50"
                  value={absenceDuration}
                  disabled={selectedCellReadOnly}
                  onChange={(e) => {
                    const raw = parseInt(e.target.value, 10);
                    const clamped = Number.isNaN(raw) ? 1 : Math.max(1, Math.min(60, raw));
                    setAbsenceDuration(clamped);
                  }}
                />
                <button
                  onClick={() => setAbsenceDuration(Math.min(60, absenceDuration + 1))}
                  disabled={selectedCellReadOnly}
                  className={`w-8 h-8 flex items-center justify-center rounded-r border border-charcoal-200 bg-white text-charcoal-600 ${
                    selectedCellReadOnly ? 'opacity-50 cursor-not-allowed' : 'hover:bg-charcoal-50'
                  }`}
                >
                  +
                </button>
              </div>
            </div>
          )}
        </div>

        {tabMode === 'project' && (
          <>
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-charcoal-500 flex items-center gap-1.5 uppercase tracking-wider">
                <Clock className="w-3 h-3" /> {t('planner.dailySchedule')}
              </h4>

              {draftAssignments.length > 0 ? (
                <div className="space-y-3">
                  <div
                    className={`grid ${
                      draftAssignments.length > 1 ? 'grid-cols-2' : 'grid-cols-1'
                    } gap-3`}
                  >
                    {draftAssignments.map((draft) => {
                      const proj = getProject(draft.projectId);
                      if (!proj) return null;
                      const hours = allocationToHours(draft.allocation);

                      return (
                        <div
                          key={draft.projectId}
                          className={`relative p-2.5 rounded-lg border flex flex-col gap-2 transition-all bg-white shadow-sm hover:shadow-md ${
                            (PASTEL_VARIANTS[proj.color] ?? PASTEL_VARIANTS.gray).border
                          }`}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div className="min-w-0 flex items-center gap-2">
                              <div
                                className={`w-2 h-2 rounded-full ${
                                  (PASTEL_VARIANTS[proj.color] ?? PASTEL_VARIANTS.gray).bg
                                } ring-1 ring-inset ring-black/5`}
                              />
                              <div className="truncate">
                                <div className="text-xs font-bold text-charcoal-900 truncate leading-none">
                                  {proj.name}
                                </div>
                                <div className="text-[10px] text-charcoal-500 truncate leading-tight mt-0.5">
                                  {proj.client}
                                </div>
                              </div>
                            </div>
                            {!selectedCellReadOnly && (
                              <button
                                onClick={() => removeDraftAssignment(draft.projectId)}
                                className="text-charcoal-300 hover:text-red-500 transition-colors -mt-0.5 -mr-0.5 p-0.5"
                                title={t('planner.remove')}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="0.5"
                              max="8"
                              step="0.5"
                              value={hours}
                              disabled={selectedCellReadOnly}
                              onChange={(e) =>
                                updateDraftHours(draft.projectId, parseFloat(e.target.value))
                              }
                              className={`flex-1 h-1.5 bg-charcoal-100 rounded-lg appearance-none accent-charcoal-700 ${
                                selectedCellReadOnly ? 'cursor-not-allowed' : 'cursor-pointer'
                              }`}
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

                  {(() => {
                    const totalAlloc = draftAssignments.reduce(
                      (acc, curr) => acc + curr.allocation,
                      0
                    );
                    const totalHours = allocationToHours(totalAlloc);
                    const isOver = totalHours > 8;
                    return (
                      <div className="bg-charcoal-50 p-3 rounded-lg border border-charcoal-100 flex items-center gap-4">
                        <span className="text-[10px] font-bold text-charcoal-500 uppercase tracking-wider w-12">
                          {t('planner.total')}
                        </span>
                        <div className="flex-1 h-2.5 bg-charcoal-200 rounded-full overflow-hidden relative">
                          <div
                            className={`absolute top-0 left-0 h-full transition-all duration-300 ${
                              isOver ? 'bg-red-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.min((totalHours / 8) * 100, 100)}%` }}
                          />
                        </div>
                        <div
                          className={`font-mono font-bold text-xs whitespace-nowrap ${
                            isOver ? 'text-red-600' : 'text-charcoal-700'
                          }`}
                        >
                          {totalHours}h <span className="text-charcoal-400 font-normal">/ 8h</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="text-xs text-charcoal-400 italic text-center py-6 border border-dashed border-charcoal-200 rounded-lg bg-charcoal-50/50">
                  {t('planner.noProjectsAssigned')}
                </div>
              )}
            </div>

            <div className="border-t border-charcoal-100 pt-4">
              <h4 className="text-sm font-medium text-charcoal-900 mb-3">{t('planner.selectProjects')}</h4>

              <div className="mb-3 space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-charcoal-400" />
                  <input
                    type="text"
                    placeholder={t('planner.searchProjects')}
                    value={projectSearchQuery}
                    disabled={selectedCellReadOnly}
                    onChange={(e) => setProjectSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white disabled:opacity-50"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setProjectFilter('all')}
                    disabled={selectedCellReadOnly}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                      projectFilter === 'all'
                        ? 'bg-charcoal-800 text-white border-charcoal-800'
                        : 'bg-white text-charcoal-600 border-charcoal-200 hover:bg-charcoal-50'
                    } ${selectedCellReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {t('planner.all')}
                  </button>
                  <button
                    onClick={() => setProjectFilter('active')}
                    disabled={selectedCellReadOnly}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                      projectFilter === 'active'
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-white text-charcoal-600 border-charcoal-200 hover:bg-charcoal-50'
                    } ${selectedCellReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {t('status.active')}
                  </button>
                  <button
                    onClick={() => setProjectFilter('opportunity')}
                    disabled={selectedCellReadOnly}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                      projectFilter === 'opportunity'
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'bg-white text-charcoal-600 border-charcoal-200 hover:bg-charcoal-50'
                    } ${selectedCellReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {t('status.opportunity')}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-y-auto custom-scrollbar p-1">
                {projects
                  .filter((p) => {
                    if (p.status !== 'active' && p.status !== 'opportunity') return false;
                    if (projectFilter !== 'all' && p.status !== projectFilter) return false;
                    if (projectSearchQuery) {
                      const q = projectSearchQuery.toLowerCase();
                      return (
                        p.name.toLowerCase().includes(q) || p.client.toLowerCase().includes(q)
                      );
                    }
                    return true;
                  })
                  .map((project) => {
                    const isAdded = draftAssignments.some((d) => d.projectId === project.id);
                    return (
                      <button
                        key={project.id}
                        onClick={() => addDraftProject(project.id)}
                        disabled={isAdded || selectedCellReadOnly}
                        className={`
                          flex items-center gap-3 p-3 rounded-lg border text-left transition-all
                          ${
                            isAdded || selectedCellReadOnly
                              ? 'bg-charcoal-50 border-charcoal-100 opacity-50 cursor-default'
                              : 'bg-white border-charcoal-200 hover:border-blue-300 hover:bg-blue-50/30 cursor-pointer'
                          }
                          ${project.isCritical ? 'border-l-4 border-l-red-400' : ''}
                        `}
                      >
                        <Folder
                          className={`w-4 h-4 flex-shrink-0 ${
                            (PASTEL_VARIANTS[project.color] ?? PASTEL_VARIANTS.gray).text
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-charcoal-900 truncate">
                              {project.name}
                            </span>
                            {project.isCritical && (
                              <AlertCircle className="w-3 h-3 text-red-500" />
                            )}
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
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setAbsenceType('vacation')}
                disabled={selectedCellReadOnly}
                className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${
                  absenceType === 'vacation'
                    ? 'border-yellow-400 bg-yellow-50 text-yellow-700'
                    : 'border-charcoal-100 bg-white text-charcoal-500 hover:border-charcoal-300'
                } ${selectedCellReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <Sun className="w-6 h-6" />
                <span className="text-sm font-medium">{t('planner.vacation')}</span>
              </button>
              <button
                onClick={() => setAbsenceType('sick')}
                disabled={selectedCellReadOnly}
                className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${
                  absenceType === 'sick'
                    ? 'border-red-400 bg-red-50 text-red-700'
                    : 'border-charcoal-100 bg-white text-charcoal-500 hover:border-charcoal-300'
                } ${selectedCellReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <Umbrella className="w-6 h-6" />
                <span className="text-sm font-medium">{t('planner.sick')}</span>
              </button>
              <button
                onClick={() => setAbsenceType('training')}
                disabled={selectedCellReadOnly}
                className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${
                  absenceType === 'training'
                    ? 'border-blue-400 bg-blue-50 text-blue-700'
                    : 'border-charcoal-100 bg-white text-charcoal-500 hover:border-charcoal-300'
                } ${selectedCellReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <BookOpen className="w-6 h-6" />
                <span className="text-sm font-medium">{t('planner.training')}</span>
              </button>
            </div>

            {draftAssignments.length > 0 && (
              <div>
                <h4 className="text-[10px] font-bold text-charcoal-500 uppercase tracking-wider mb-2">
                  {t('planner.assigned')}
                </h4>
                <div className="flex flex-wrap gap-2">
                  {draftAssignments.map((draft) => {
                    const proj = getProject(draft.projectId);
                    if (!proj) return null;
                    const hours = allocationToHours(draft.allocation);
                    return (
                      <div
                        key={draft.projectId}
                        className={`text-[10px] pl-1 pr-0.5 py-0.5 rounded border shadow-sm flex items-center gap-1 ${
                          (PASTEL_VARIANTS[proj.color] ?? PASTEL_VARIANTS.gray).bg
                        } ${(PASTEL_VARIANTS[proj.color] ?? PASTEL_VARIANTS.gray).text} ${
                          (PASTEL_VARIANTS[proj.color] ?? PASTEL_VARIANTS.gray).border
                        } ring-2 ring-amber-400`}
                      >
                        <Folder className="w-2.5 h-2.5 flex-shrink-0" />
                        <span className="truncate">{proj.name}</span>
                        <span className="text-[8px] font-bold opacity-70 border border-current px-0.5 rounded whitespace-nowrap">
                          {hours}h
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {selectedCellReadOnly && (
          <div className="flex items-center gap-2 text-xs font-medium text-charcoal-500 bg-charcoal-100 px-3 py-2 rounded-lg border border-charcoal-200">
            <Lock className="w-3 h-3" />
            {t('planner.readOnly')}
          </div>
        )}

        {!selectedCellReadOnly && hasConflict && (
          <div className="flex items-start gap-2 text-amber-700 bg-amber-50 p-3 rounded-lg border border-amber-100 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{t(tabMode === 'project' ? 'planner.conflictAbsence' : 'planner.conflictAssignments')}</span>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-charcoal-100">
          {selectedCellReadOnly && selectedCellAbsence && (
            <Button
              variant="outline"
              className="mr-auto gap-2 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
              onClick={handleDeleteAbsence}
            >
              <Trash2 className="w-4 h-4" />
              {t('planner.deleteAbsence')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>{t('planner.cancel')}</Button>
          {!selectedCellReadOnly &&
            (!isRepeatMode || tabMode === 'absence' || draftAssignments.length > 0) && (
              <Button onClick={handleSave}>{t('planner.save')}</Button>
            )}
        </div>
      </div>
    </Modal>
  );
});

export default DayEditModal;
