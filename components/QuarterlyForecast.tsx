

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { QuarterData, Project, Assignment, Employee, Absence, PublicHoliday } from '../types';
import { PASTEL_VARIANTS, MOCK_HOLIDAYS } from '../constants';
import { Badge } from './ui/Badge';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { TrendingUp, AlertCircle, Calculator, Target, GitBranch, FileText, Trash2, Plus, X, Lock, Sparkles, BrainCircuit, Folder, Cpu, ShieldAlert, Activity, ChevronRight, Settings, CornerLeftDown, Dices, Zap } from 'lucide-react';
import { Button } from './ui/Button';
import { useLanguage } from '../contexts/LanguageContext';
import { PageHeader } from './ui/PageHeader';
import { useSettings } from '../contexts/SettingsContext';
import { generateForecastAnalysis, AI_MODEL_FORECAST } from '../services/ai';
import { Modal } from './ui/Modal';
import { AsciiSpinner } from './ui/AsciiSpinner';
import { forecastToJSON, downloadTextFile } from '../utils/export';
import { format } from 'date-fns';
import {
  computeQuarterCapacity,
  computeMonthlyBreakdown,
  runMonteCarloSimulation,
  calculateCapacityMetrics,
  type SimResult,
} from '../utils/forecast';

interface QuarterlyForecastProps {
  data: QuarterData[];
  allProjects: Project[]; // To select from
  assignments: Assignment[];
  employees: Employee[];
  absences: Absence[];
  onUpdateForecast?: (quarterId: string, type: 'mustWin' | 'alternative', projects: Project[]) => void;
  readOnly?: boolean;
}

// --- Sci-Fi UI Helpers ---

const FormatText: React.FC<{ text: string }> = ({ text }) => {
  if (!text) return null;
  // Split by bold markers **...**
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <span key={i} className="font-bold text-blue-300">{part.slice(2, -2)}</span>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
};

const ParsedResultDisplay: React.FC<{ rawText: string }> = ({ rawText }) => {
    // Parser Logic
    const parsedData = useMemo(() => {
        const sections: { type: 'header' | 'status' | 'risk' | 'action' | 'text', title?: string, content: string, items?: string[], percentage?: string | null }[] = [];
        
        const lines = rawText.split('\n').filter(line => line.trim() !== '');
        
        let currentSection: any = null;

        lines.forEach(line => {
            const lower = line.toLowerCase();
            
            // Heuristic Detection
            if (line.trim().startsWith('**') && lower.includes('zusammenfassung') || lower.includes('summary')) {
                if (currentSection) sections.push(currentSection);
                currentSection = { type: 'header', content: line.replace(/\*\*/g, '') };
            } else if (lower.includes('status:') || lower.includes('kapazitätsstatus') || (lower.includes('status') && line.includes('**'))) {
                if (currentSection) sections.push(currentSection);
                // Extract percentage if present
                const percentMatch = line.match(/(\d+)%/);
                const percentage = percentMatch ? percentMatch[1] : null;
                currentSection = { type: 'status', title: 'SYSTEM STATUS', content: line, percentage };
            } else if (lower.includes('risiko') || lower.includes('risk') || lower.includes('lücken') || lower.includes('gaps')) {
                if (currentSection) sections.push(currentSection);
                currentSection = { type: 'risk', title: 'THREAT ASSESSMENT', content: '' };
            } else if (lower.includes('empfehlungen') || lower.includes('recommendations') || lower.includes('handlung')) {
                if (currentSection) sections.push(currentSection);
                currentSection = { type: 'action', title: 'TACTICAL DIRECTIVES', content: '', items: [] };
            } else if (line.match(/^\d+\./)) {
                // Numbered list item
                if (currentSection && currentSection.type === 'action') {
                    currentSection.items.push(line.replace(/^\d+\.\s*/, ''));
                } else {
                     if (currentSection) currentSection.content += '\n' + line;
                }
            } else {
                if (currentSection) {
                    // Append to current section content, unless it's a new "block" appearing line
                    if(currentSection.type === 'risk' && line.trim().startsWith('**')) {
                         // Treat bold lines inside risk as sub-headers or strong points, just append
                         currentSection.content += '\n' + line;
                    } else {
                         currentSection.content += (currentSection.content ? '\n' : '') + line;
                    }
                } else {
                    currentSection = { type: 'text', content: line };
                }
            }
        });
        if (currentSection) sections.push(currentSection);
        
        return sections;
    }, [rawText]);

    return (
        <div className="flex flex-col gap-6 font-mono text-sm relative p-2">
            {/* Light Tech Overlay Effect */}
            <div className="absolute inset-0 pointer-events-none z-0 opacity-10 bg-[linear-gradient(rgba(59,130,246,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.1)_1px,transparent_1px)] bg-[size:20px_20px]"></div>

            {parsedData.map((section, idx) => {
                const delay = { animationDelay: `${idx * 150}ms` };
                
                if (section.type === 'header') {
                    return (
                        <div key={idx} className="border-b border-charcoal-700 pb-2 mb-2 animate-fade-in-up" style={delay}>
                            <h3 className="text-blue-400 font-bold tracking-widest uppercase flex items-center gap-2 text-base">
                                <Activity className="w-5 h-5 animate-pulse text-blue-500" />
                                {section.content}
                            </h3>
                        </div>
                    );
                }

                if (section.type === 'status') {
                    return (
                        <div key={idx} className="bg-charcoal-800/80 border border-blue-500/30 rounded-lg p-5 relative overflow-hidden group animate-slide-in-right shadow-sm" style={delay}>
                            <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
                                <Cpu className="w-24 h-24 text-blue-400" />
                            </div>
                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500"></div>
                            <div className="flex items-start gap-5 relative z-10">
                                {section.percentage && (
                                    <div className="flex-shrink-0">
                                        <div className="w-20 h-20 rounded-full border-4 border-charcoal-700 flex items-center justify-center bg-charcoal-800 relative">
                                            <div className="absolute inset-0 border-t-4 border-blue-500 rounded-full animate-spin duration-3000"></div>
                                            <span className="text-2xl font-bold text-blue-400">{section.percentage}%</span>
                                        </div>
                                    </div>
                                )}
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                                        <div className="text-xs text-blue-400 uppercase tracking-widest font-bold">{section.title}</div>
                                    </div>
                                    <div className="text-gray-300 leading-relaxed text-sm">
                                        <FormatText text={section.content} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                }

                if (section.type === 'risk') {
                    return (
                        <div key={idx} className="relative animate-fade-in-up" style={delay}>
                            <div className="absolute -left-1 top-0 bottom-0 w-1 bg-gradient-to-b from-red-500 via-red-400 to-transparent"></div>
                            <div className="bg-red-900/10 border border-red-900/30 p-4 rounded-r-lg">
                                <div className="flex items-center gap-2 mb-2">
                                    <ShieldAlert className="w-4 h-4 text-red-400 animate-pulse" />
                                    <span className="text-xs text-red-400 uppercase tracking-widest font-bold">{section.title}</span>
                                </div>
                                <div className="text-gray-300 text-sm leading-relaxed pl-1">
                                    <FormatText text={section.content} />
                                </div>
                            </div>
                        </div>
                    );
                }

                if (section.type === 'action') {
                    return (
                        <div key={idx} className="mt-4 animate-fade-in-up" style={delay}>
                            <div className="flex items-center gap-2 mb-4 border-b border-yellow-800/50 pb-1">
                                <Zap className="w-4 h-4 text-yellow-500" />
                                <span className="text-xs text-yellow-500 uppercase tracking-widest font-bold">{section.title}</span>
                            </div>
                            <div className="space-y-3">
                                {section.items?.map((item, i) => (
                                    <div key={i} className="flex gap-4 bg-charcoal-800 p-3 rounded-md border-l-2 border-l-yellow-600 border-y border-r border-charcoal-700 hover:border-yellow-600/50 transition-all hover:translate-x-1 group shadow-sm">
                                        <div className="flex flex-col items-center gap-1 min-w-[2rem]">
                                            <span className="text-[10px] text-charcoal-500 font-bold uppercase">CMD</span>
                                            <span className="text-lg font-bold text-yellow-500 font-mono">0{i + 1}</span>
                                        </div>
                                        <div className="text-gray-300 text-sm leading-relaxed flex-1 pt-1">
                                            <FormatText text={item} />
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-charcoal-600 group-hover:text-yellow-500 self-center" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                }

                return (
                    <div key={idx} className="text-gray-400 text-sm animate-fade-in pl-2 border-l border-charcoal-700" style={delay}>
                        <FormatText text={section.content} />
                    </div>
                );
            })}
        </div>
    );
};

interface CommitNumberInputProps {
  value: number;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
  'aria-label': string;
  className?: string;
  disabled?: boolean;
}

const CommitNumberInput: React.FC<CommitNumberInputProps> = ({
  value,
  min,
  max,
  onCommit,
  'aria-label': ariaLabel,
  className = '',
  disabled,
}) => {
  const [draft, setDraft] = useState(() => String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = useCallback(() => {
    let parsed = draft.trim() === '' ? 0 : Number(draft);
    if (Number.isNaN(parsed)) parsed = 0;
    if (min !== undefined) parsed = Math.max(min, parsed);
    if (max !== undefined) parsed = Math.min(max, parsed);
    onCommit(parsed);
    setDraft(String(parsed));
  }, [draft, min, max, onCommit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setDraft(String(value));
      e.currentTarget.blur();
    }
  }, [commit, value]);

  return (
    <input
      type="number"
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={className}
      value={draft}
      min={min}
      max={max}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  );
};

interface ForecastQuarterCardProps {
  quarter: QuarterData;
  index: number;
  allProjects: Project[];
  employees: Employee[];
  absences: Absence[];
  holidays: PublicHoliday[];
  assignments: Assignment[];
  readOnly: boolean;
  onUpdateForecast?: (quarterId: string, type: 'mustWin' | 'alternative', projects: Project[]) => void;
  isAddingMustWin: boolean;
  isAddingAlt: boolean;
  setAddingTo: (value: { qId: string; type: 'mustWin' | 'alternative' } | null) => void;
  onRunMonteCarlo: (quarter: QuarterData) => void;
}

const ForecastQuarterCard = React.memo<ForecastQuarterCardProps>(({
  quarter,
  index,
  allProjects,
  employees,
  absences,
  holidays,
  assignments,
  readOnly,
  onUpdateForecast,
  isAddingMustWin,
  isAddingAlt,
  setAddingTo,
  onRunMonteCarlo,
}) => {
  const { t, formatDate } = useLanguage();

  const computedQuarter = useMemo(() => computeQuarterCapacity({
    quarter,
    employees,
    absences,
    holidays,
    assignments,
    allProjects,
  }), [quarter, employees, absences, holidays, assignments, allProjects]);

  const metrics = useMemo(() => calculateCapacityMetrics(computedQuarter), [computedQuarter]);
  const monthlyData = useMemo(() => computeMonthlyBreakdown(computedQuarter, metrics), [computedQuarter, metrics]);

  const currentIds = useMemo(() => [
    ...computedQuarter.runningProjects,
    ...computedQuarter.mustWinOpportunities,
    ...computedQuarter.alternativeOpportunities,
  ].map(p => p.id), [computedQuarter]);

  const availableProjects = useMemo(() => allProjects.filter(p => p.status === 'opportunity' && !currentIds.includes(p.id)), [allProjects, currentIds]);

  const handleUpdateProject = useCallback((
    type: 'mustWin' | 'alternative',
    projects: Project[],
    updatedProject: Project,
    field: 'volume' | 'budget' | 'probability',
    value: string | number
  ) => {
    if (readOnly || !onUpdateForecast) return;
    const updatedList = projects.map(p => (p.id === updatedProject.id ? { ...p, [field]: value } : p));
    onUpdateForecast(quarter.id, type, updatedList);
  }, [readOnly, onUpdateForecast, quarter.id]);

  const handleRemoveProject = useCallback((
    type: 'mustWin' | 'alternative',
    projects: Project[],
    projectId: string
  ) => {
    if (readOnly || !onUpdateForecast) return;
    onUpdateForecast(quarter.id, type, projects.filter(p => p.id !== projectId));
  }, [readOnly, onUpdateForecast, quarter.id]);

  const handleAddProject = useCallback((
    type: 'mustWin' | 'alternative',
    currentProjects: Project[],
    newProject: Project
  ) => {
    if (readOnly || !onUpdateForecast) return;
    const projectToAdd = { ...newProject, volume: newProject.volume || 30 };
    onUpdateForecast(quarter.id, type, [...currentProjects, projectToAdd]);
    setAddingTo(null);
  }, [readOnly, onUpdateForecast, quarter.id, setAddingTo]);

  const isCurrent = index === 0;

  return (
    <div
      className={`flex flex-col bg-white rounded-xl border ${isCurrent ? 'border-charcoal-300 shadow-lg ring-1 ring-charcoal-200' : 'border-charcoal-200 shadow-sm'} transition-all duration-300 hover:shadow-xl hover:-translate-y-1`}
    >
      {/* Header */}
      <div className="p-5 border-b border-charcoal-100 bg-charcoal-50/30 rounded-t-xl flex justify-between items-start">
        <div>
          <div className="flex justify-between items-center mb-2 gap-2">
            <h2 className="text-lg font-bold text-charcoal-800">{quarter.name}</h2>
            {isCurrent && <Badge color="green">{t('forecast.current')}</Badge>}
          </div>
          <div className="flex gap-2 text-xs text-charcoal-500 font-mono">
            {quarter.months.join(' · ')}
          </div>
        </div>
        {!readOnly && (
          <button
            onClick={() => onRunMonteCarlo(computedQuarter)}
            className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100 transition-colors"
            title={t('forecast.monteCarlo')}
          >
            <Dices className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="p-5 space-y-6 flex-1">

        {/* Capacity Summary */}
        <div className="bg-charcoal-50 rounded-lg p-4 border border-charcoal-100">
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm font-medium text-charcoal-600 flex items-center gap-2">
              <Calculator className="w-4 h-4" /> {t('forecast.teamCapacity')}
            </span>
            <span className="text-lg font-bold text-charcoal-900">{metrics.totalCap}d</span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-charcoal-500">
              <span>{t('forecast.runningProjects')}</span>
              <span className="text-charcoal-700 font-medium">-{metrics.assignedDays}d</span>
            </div>
            <div className="border-t border-charcoal-200 pt-2 flex justify-between font-medium">
              <span className="text-blue-700">{t('forecast.available')}</span>
              <span className="text-blue-700">{metrics.availableAfterRunning}d</span>
            </div>
          </div>
        </div>

        {/* Monthly Breakdown Table */}
        <div>
          <h3 className="text-xs font-semibold text-charcoal-400 uppercase tracking-wider mb-3">{t('forecast.monthlySplit')}</h3>
          <div className="overflow-hidden rounded-lg border border-charcoal-200 shadow-sm">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-charcoal-200">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-charcoal-500">{t('forecast.metric')}</th>
                  {monthlyData.map(d => (
                    <th key={d.month} className="px-3 py-2 text-right font-semibold text-charcoal-500">{d.month}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-charcoal-100 bg-white">
                <tr>
                  <td className="px-3 py-2 font-medium text-charcoal-600">{t('forecast.totalCapacity')}</td>
                  {monthlyData.map(d => (
                    <td key={d.month} className="px-3 py-2 text-right font-mono text-charcoal-900">{d.total}</td>
                  ))}
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium text-blue-600">{t('forecast.available')}</td>
                  {monthlyData.map(d => (
                    <td key={d.month} className={`px-3 py-2 text-right font-mono font-bold ${d.rawAvailable < 0 ? 'text-red-600' : 'text-blue-600'}`}>
                      {d.rawAvailable}
                    </td>
                  ))}
                </tr>
                <tr className="bg-purple-50/30">
                  <td className="px-3 py-2 font-medium text-purple-600">{t('forecast.optimistic')}</td>
                  {monthlyData.map(d => (
                    <td key={d.month} className={`px-3 py-2 text-right font-mono font-bold ${d.optimistic < 0 ? 'text-red-500' : 'text-purple-600'}`}>
                      {d.optimistic}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Running Projects */}
        <div>
          <h3 className="text-xs font-semibold text-charcoal-400 uppercase tracking-wider mb-3">{t('forecast.runningProjects')}</h3>
          <div className="space-y-2">
            {computedQuarter.runningProjects.length > 0 ? computedQuarter.runningProjects.map(p => (
              <div key={p.id} className="group flex items-center justify-between p-2 rounded-md hover:bg-gray-50 border border-transparent hover:border-gray-100 transition-all">
                <div className="flex items-center gap-3 overflow-hidden">
                  <Folder className={`w-4 h-4 flex-shrink-0 ${(PASTEL_VARIANTS[p.color] ?? PASTEL_VARIANTS.gray).text}`} />
                  <div className="truncate">
                    <div className="text-sm font-medium text-charcoal-800 truncate">{p.name}</div>
                    <div className="text-xs text-charcoal-500 truncate">{p.client}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-col items-end">
                    <div className="text-[10px] text-charcoal-500 font-medium">
                      {p.volume}d
                    </div>
                    <div className="text-xs font-mono text-charcoal-400 whitespace-nowrap">
                      {p.budget && p.budget !== '0' ? p.budget : 'T&M'}
                    </div>
                  </div>
                </div>
              </div>
            )) : <div className="text-xs text-charcoal-400 italic pl-2">{t('forecast.noActive')}</div>}
          </div>
        </div>

        {/* Must Win Opportunities */}
        <div>
          <h3 className="text-xs font-semibold text-charcoal-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <TrendingUp className="w-3 h-3" /> {t('forecast.mustWin')}
          </h3>
          <div className="space-y-2">
            {quarter.mustWinOpportunities.length > 0 ? quarter.mustWinOpportunities.map(p => (
              <div key={p.id} className="group p-3 rounded-lg border border-orange-100 bg-orange-50/30 hover:border-orange-200 transition-colors relative">
                <div className="flex justify-between items-start">
                  <div className="flex items-start gap-2.5 flex-1 min-w-0 pr-2">
                    <Target className={`w-4 h-4 mt-0.5 flex-shrink-0 ${(PASTEL_VARIANTS[p.color] ?? PASTEL_VARIANTS.gray).text}`} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-charcoal-800 truncate">{p.name}</div>
                      <div className="text-xs text-charcoal-500">{p.client}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="flex items-center gap-1">
                      <CommitNumberInput
                        value={p.probability ?? 70}
                        min={0}
                        max={100}
                        disabled={readOnly}
                        className={`w-9 h-6 text-right text-xs font-bold text-gray-500 rounded border border-orange-200 focus:border-orange-400 focus:outline-none px-1 ${readOnly ? 'bg-transparent border-transparent' : 'bg-orange-100'}`}
                        onCommit={(v) => handleUpdateProject('mustWin', quarter.mustWinOpportunities, p, 'probability', v)}
                        aria-label={t('forecast.probability')}
                      />
                      <span className="text-[10px] text-gray-400 mr-1">%</span>

                      <CommitNumberInput
                        value={p.volume || 0}
                        min={0}
                        disabled={readOnly}
                        className={`w-12 h-6 text-right text-xs font-bold text-orange-600 rounded border border-orange-200 focus:border-orange-400 focus:outline-none px-1 ${readOnly ? 'bg-transparent border-transparent' : 'bg-orange-100'}`}
                        onCommit={(v) => handleUpdateProject('mustWin', quarter.mustWinOpportunities, p, 'volume', v)}
                        aria-label={t('forecast.volumeDays')}
                      />
                      <span className="text-[10px] text-orange-500 font-medium">d</span>
                    </div>

                    {/* Actions */}
                    {!readOnly && (
                      <div className="flex items-center">
                        <button
                          onClick={() => handleRemoveProject('mustWin', quarter.mustWinOpportunities, p.id)}
                          className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded ml-1 transition-colors"
                          title={t('forecast.remove')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-charcoal-500 pl-6.5 flex justify-between items-center">
                  <span>{t('forecast.start')}: {p.startDate ? formatDate(new Date(p.startDate), 'MMM d, yyyy') : 'TBD'}</span>
                  <input
                    type="text"
                    disabled={readOnly}
                    className={`w-16 h-5 text-right font-mono text-charcoal-500 bg-transparent border-b hover:border-orange-200 focus:border-orange-400 focus:outline-none ${readOnly ? 'border-transparent' : 'border-transparent'}`}
                    value={p.budget || ''}
                    onChange={(e) => handleUpdateProject('mustWin', quarter.mustWinOpportunities, p, 'budget', e.target.value)}
                    placeholder={readOnly ? '' : t('forecast.budgetPlaceholder')}
                  />
                </div>
              </div>
            )) : <div className="text-xs text-charcoal-400 italic pl-2">{t('forecast.noneIdentified')}</div>}

            {/* Add Button */}
            {!readOnly && (
              <div className="relative pt-1">
                {!isAddingMustWin ? (
                  <button
                    onClick={() => setAddingTo({ qId: quarter.id, type: 'mustWin' })}
                    className="flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 hover:bg-orange-50 px-2 py-1 rounded transition-colors w-full justify-center border border-dashed border-orange-200"
                  >
                    <Plus className="w-3.5 h-3.5" /> {t('forecast.addOpp')}
                  </button>
                ) : (
                  <div className="absolute left-0 right-0 top-0 z-10 bg-white border border-orange-200 shadow-lg rounded-lg p-2 animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between mb-2 pb-1 border-b border-orange-100">
                      <span className="text-xs font-semibold text-orange-700">{t('forecast.selectProject')}</span>
                      <button onClick={() => setAddingTo(null)} className="text-charcoal-400 hover:text-charcoal-600"><X className="w-3 h-3" /></button>
                    </div>
                    <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                      {availableProjects.length > 0 ? availableProjects.map(p => (
                        <button
                          key={p.id}
                          onClick={() => handleAddProject('mustWin', quarter.mustWinOpportunities, p)}
                          className="w-full text-left flex items-center justify-between px-2 py-1.5 rounded hover:bg-orange-50 group"
                        >
                          <span className="flex items-center gap-2">
                            <Folder className={`w-3 h-3 ${(PASTEL_VARIANTS[p.color] ?? PASTEL_VARIANTS.gray).text}`} />
                            <span className="text-xs text-charcoal-700 font-medium group-hover:text-orange-700">{p.name}</span>
                          </span>
                          <span className="text-[10px] text-charcoal-400">{p.client}</span>
                        </button>
                      )) : (
                        <div className="text-xs text-charcoal-400 py-2 text-center">{t('forecast.noMoreOpp')}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Alternative Opportunities */}
        <div>
          <h3 className="text-xs font-semibold text-charcoal-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <GitBranch className="w-3 h-3" /> {t('forecast.alternatives')}
          </h3>
          <div className="space-y-2">
            {quarter.alternativeOpportunities.length > 0 ? quarter.alternativeOpportunities.map(p => (
              <div key={p.id} className="group p-3 rounded-lg border border-blue-100 bg-blue-50/30 hover:border-blue-200 transition-colors relative">
                <div className="flex justify-between items-start">
                  <div className="flex items-start gap-2.5 flex-1 min-w-0 pr-2">
                    <Folder className={`w-4 h-4 mt-0.5 flex-shrink-0 ${(PASTEL_VARIANTS[p.color] ?? PASTEL_VARIANTS.gray).text}`} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-charcoal-800 truncate">{p.name}</div>
                      <div className="text-xs text-charcoal-500">{p.client}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="flex items-center gap-1">
                      <CommitNumberInput
                        value={p.probability ?? 30}
                        min={0}
                        max={100}
                        disabled={readOnly}
                        className={`w-9 h-6 text-right text-xs font-bold text-gray-500 rounded border border-blue-200 focus:border-blue-400 focus:outline-none px-1 ${readOnly ? 'bg-transparent border-transparent' : 'bg-blue-100'}`}
                        onCommit={(v) => handleUpdateProject('alternative', quarter.alternativeOpportunities, p, 'probability', v)}
                        aria-label={t('forecast.probability')}
                      />
                      <span className="text-[10px] text-gray-400 mr-1">%</span>

                      <CommitNumberInput
                        value={p.volume || 0}
                        min={0}
                        disabled={readOnly}
                        className={`w-12 h-6 text-right text-xs font-bold text-blue-600 rounded border border-blue-200 focus:border-blue-400 focus:outline-none px-1 ${readOnly ? 'bg-transparent border-transparent' : 'bg-blue-100'}`}
                        onCommit={(v) => handleUpdateProject('alternative', quarter.alternativeOpportunities, p, 'volume', v)}
                        aria-label={t('forecast.volumeDays')}
                      />
                      <span className="text-[10px] text-blue-500 font-medium">d</span>
                    </div>

                    {!readOnly && (
                      <div className="flex items-center">
                        <button
                          onClick={() => handleRemoveProject('alternative', quarter.alternativeOpportunities, p.id)}
                          className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded ml-1 transition-colors"
                          title={t('forecast.remove')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-charcoal-500 pl-5 flex justify-between items-center">
                  <span>{t('forecast.start')}: {p.startDate ? formatDate(new Date(p.startDate), 'MMM d, yyyy') : 'TBD'}</span>
                  <input
                    type="text"
                    disabled={readOnly}
                    className={`w-16 h-5 text-right font-mono text-charcoal-500 bg-transparent border-b hover:border-blue-200 focus:border-blue-400 focus:outline-none ${readOnly ? 'border-transparent' : 'border-transparent'}`}
                    value={p.budget || ''}
                    onChange={(e) => handleUpdateProject('alternative', quarter.alternativeOpportunities, p, 'budget', e.target.value)}
                    placeholder={readOnly ? '' : t('forecast.budgetPlaceholder')}
                  />
                </div>
              </div>
            )) : <div className="text-xs text-charcoal-400 italic pl-2">{t('forecast.noneIdentified')}</div>}

            {/* Add Button */}
            {!readOnly && (
              <div className="relative pt-1">
                {!isAddingAlt ? (
                  <button
                    onClick={() => setAddingTo({ qId: quarter.id, type: 'alternative' })}
                    className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2 py-1 rounded transition-colors w-full justify-center border border-dashed border-blue-200"
                  >
                    <Plus className="w-3.5 h-3.5" /> {t('forecast.addAlt')}
                  </button>
                ) : (
                  <div className="absolute left-0 right-0 top-0 z-10 bg-white border border-blue-200 shadow-lg rounded-lg p-2 animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between mb-2 pb-1 border-b border-blue-100">
                      <span className="text-xs font-semibold text-blue-700">{t('forecast.selectProject')}</span>
                      <button onClick={() => setAddingTo(null)} className="text-charcoal-400 hover:text-charcoal-600"><X className="w-3 h-3" /></button>
                    </div>
                    <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                      {availableProjects.length > 0 ? availableProjects.map(p => (
                        <button
                          key={p.id}
                          onClick={() => handleAddProject('alternative', quarter.alternativeOpportunities, p)}
                          className="w-full text-left flex items-center justify-between px-2 py-1.5 rounded hover:bg-blue-50 group"
                        >
                          <span className="flex items-center gap-2">
                            <Folder className={`w-3 h-3 ${(PASTEL_VARIANTS[p.color] ?? PASTEL_VARIANTS.gray).text}`} />
                            <span className="text-xs text-charcoal-700 font-medium group-hover:text-blue-700">{p.name}</span>
                          </span>
                          <span className="text-[10px] text-charcoal-400">{p.client}</span>
                        </button>
                      )) : (
                        <div className="text-xs text-charcoal-400 py-2 text-center">{t('forecast.noMoreOpp')}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Final Calculation */}
        <div className="pt-4 border-t border-charcoal-100">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-charcoal-600">{t('forecast.netCapacity')}</span>
            <div className={`text-xl font-bold ${metrics.finalAvailable < 0 ? 'text-red-500' : 'text-green-600'}`}>
              {metrics.finalAvailable > 0 ? '+' : ''}{metrics.finalAvailable}d
            </div>
          </div>
          {metrics.finalAvailable < 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600 bg-red-50 p-2 rounded">
              <AlertCircle className="w-3 h-3" /> {t('forecast.overcapacity')}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="bg-yellow-50/50 p-3 rounded text-xs text-charcoal-600 border border-yellow-100">
          <span className="font-semibold block mb-1">{t('forecast.notes')}</span>
          {quarter.notes}
        </div>
      </div>

    </div>
  );
});

export const QuarterlyForecast: React.FC<QuarterlyForecastProps> = ({ 
  data, 
  allProjects, 
  assignments, 
  employees, 
  absences,
  onUpdateForecast, 
  readOnly = false 
}) => {
  const { t, language } = useLanguage();
  const { apiKey, isAiEnabled, openSettings } = useSettings();
  const [addingTo, setAddingTo] = useState<{ qId: string, type: 'mustWin' | 'alternative' } | null>(null);
  
  // AI State
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);

  // Sim State
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [isSimModalOpen, setIsSimModalOpen] = useState(false);

  const binWidth = useMemo(() => {
    if (!simResult || simResult.histogram.length === 0) return 1;
    return simResult.maxVol === simResult.minVol
      ? 1
      : (simResult.maxVol - simResult.minVol) / simResult.histogram.length;
  }, [simResult]);

  // Dynamic calculation helpers live in utils/forecast.ts.

  const handleExportForecastJSON = () => {
    const json = forecastToJSON(data);
    const filename = `forecast-${format(new Date(), 'yyyy-MM-dd')}.json`;
    downloadTextFile(filename, json, 'application/json');
  };

  const handleAIAnalysis = async () => {
    // Always open modal, regardless of setting status to show motivation if needed
    setIsAnalysisModalOpen(true);

    if (!isAiEnabled || !apiKey) {
      return;
    }

    setAnalyzing(true);
    setAnalysisResult(null);

    try {
        // Analyze the first quarter (most relevant), calculating real metrics first
        const firstQuarter = data[0];
        if (!firstQuarter) {
            setAnalysisResult(t('forecast.noData'));
            return;
        }
        const realData = computeQuarterCapacity({
          quarter: firstQuarter,
          employees,
          absences,
          holidays: MOCK_HOLIDAYS,
          assignments,
          allProjects,
        });
        const result = await generateForecastAnalysis(realData, apiKey, language);
        setAnalysisResult(result);
    } catch (error) {
        setAnalysisResult(t('forecast.analysisError'));
    } finally {
        setAnalyzing(false);
    }
  };

  const handleRunMonteCarlo = useCallback((quarter: QuarterData) => {
      const result = runMonteCarloSimulation(quarter);
      setSimResult(result);
      setIsSimModalOpen(true);
  }, []);


  return (
    <div className="h-full overflow-auto bg-gray-50/50 p-6">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title={t('forecast.title')}
          subtitle={t('forecast.subtitle')}
          actions={
            <>
              <Button onClick={handleAIAnalysis} variant="secondary" className="gap-2 shadow-sm border border-charcoal-200 text-blue-700 bg-white hover:bg-blue-50 transition-all hover:scale-105">
                <Sparkles className="w-4 h-4" />
                {t('forecast.aiAnalysis')}
              </Button>
              <Button onClick={handleExportForecastJSON} className="gap-2 shadow-sm">
                <FileText className="w-4 h-4" />
                {t('forecast.exportJSON')}
              </Button>
            </>
          }
        />
        {readOnly && (
          <div className="max-w-7xl mx-auto mb-4">
            <div className="px-2 py-0.5 rounded text-xs font-bold bg-charcoal-100 text-charcoal-500 inline-flex items-center gap-1 border border-charcoal-200">
              <Lock className="w-3 h-3" /> Read Only
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {data.map((quarter, index) => (
            <ForecastQuarterCard
              key={quarter.id}
              quarter={quarter}
              index={index}
              allProjects={allProjects}
              employees={employees}
              absences={absences}
              holidays={MOCK_HOLIDAYS}
              assignments={assignments}
              readOnly={readOnly}
              onUpdateForecast={onUpdateForecast}
              isAddingMustWin={addingTo?.qId === quarter.id && addingTo?.type === 'mustWin'}
              isAddingAlt={addingTo?.qId === quarter.id && addingTo?.type === 'alternative'}
              setAddingTo={setAddingTo}
              onRunMonteCarlo={handleRunMonteCarlo}
            />
          ))}
        </div>
      </div>
      
      {/* AI Analysis Modal - Dark Mode */}
      <Modal isOpen={isAnalysisModalOpen} onClose={() => setIsAnalysisModalOpen(false)} title={(!isAiEnabled || !apiKey) ? t('forecast.aiSetupTitle') : t('forecast.analysisTitle')} size="lg" variant="dark">
         <div className="p-2">
            {(!isAiEnabled || !apiKey) ? (
                 <div className="flex flex-col items-center justify-center py-8 text-center space-y-6 max-w-md mx-auto animate-fade-in-up">
                     <div className="w-20 h-20 bg-charcoal-800 rounded-full flex items-center justify-center mb-2 shadow-sm border border-charcoal-700">
                         <BrainCircuit className="w-10 h-10 text-blue-500" />
                     </div>
                     
                     <div>
                        <h3 className="text-xl font-bold text-white mb-3">{t('forecast.aiSetupTitle')}</h3>
                        <p className="text-gray-400 text-sm leading-relaxed px-4">
                            {t('forecast.aiSetupBody')}
                        </p>
                     </div>
        
                     <div className="bg-charcoal-800/50 border border-charcoal-700 rounded-xl p-5 text-left w-full shadow-sm mb-2">
                        <div className="flex gap-4">
                            <div className="mt-1 bg-charcoal-900 p-1.5 rounded-lg border border-charcoal-700 h-fit shadow-sm"><Lock className="w-4 h-4 text-blue-500" /></div>
                            <div className="text-sm text-gray-300">
                                <div className="font-bold text-white mb-1">{t('forecast.aiPrivacyTitle')}</div> 
                                <div className="text-xs leading-relaxed text-gray-400">{t('forecast.aiPrivacyBody')}</div>
                            </div>
                        </div>
                     </div>
        
                     <div className="w-full flex flex-col items-center gap-4">
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                            <CornerLeftDown className="w-4 h-4 text-gray-600" />
                            <span>{t('forecast.openSettingsInstruction')}</span>
                        </div>
                        
                        <Button 
                            onClick={() => {
                                setIsAnalysisModalOpen(false);
                                openSettings();
                            }} 
                            className="w-full gap-2 justify-center bg-blue-600 hover:bg-blue-700 text-white border-none"
                        >
                            <Settings className="w-4 h-4" />
                            {t('forecast.configureSettings')}
                        </Button>
                     </div>
                 </div>
            ) : analyzing ? (
                <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                    {/* BrainCircuit Icon */}
                    <div className="mb-2 relative group">
                        <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full animate-pulse"></div>
                        <BrainCircuit className="w-16 h-16 text-blue-400 relative z-10 animate-pulse-subtle" />
                    </div>

                    <div>
                        <p className="text-white font-semibold text-lg tracking-tight flex items-center justify-center gap-2">
                            {t('forecast.generatingAnalysis')}
                            <span className="animate-pulse">_</span>
                        </p>
                        <p className="text-xs text-gray-500 font-mono mt-1">{t('forecast.processingVia').replace('{{model}}', AI_MODEL_FORECAST)}</p>
                    </div>
                    
                    {/* Scanning Line Animation */}
                    <div className="w-48 h-1 bg-charcoal-700 rounded-full overflow-hidden mt-4 relative">
                        <div className="absolute top-0 bottom-0 w-1/3 bg-blue-500 rounded-full animate-scan"></div>
                    </div>
                    
                    {/* Mock terminal output for sci-fi feel */}
                    <div className="mt-4 w-full max-w-md bg-charcoal-900 rounded-lg p-3 text-left font-mono text-xs text-gray-400 border border-charcoal-700 shadow-inner">
                        <div className="flex gap-2 mb-1">
                            <span className="text-blue-500">➜</span>
                            <span className="text-gray-300">analyze --target=q1_forecast --deep</span>
                        </div>
                        <div className="text-gray-500 mb-1">Loading context... Done</div>
                        <div className="text-gray-500 mb-1">Parsing quarterly metrics... Done</div>
                        <div className="flex gap-1">
                            <span className="text-gray-500">Reasoning</span>
                            <AsciiSpinner className="text-green-500" />
                        </div>
                    </div>
                </div>
            ) : analysisResult ? (
                <div className="bg-charcoal-900 rounded-xl shadow-2xl border border-charcoal-700 overflow-hidden text-gray-200 relative min-h-[400px]">
                    {/* HUD Header */}
                    <div className="bg-charcoal-950/80 px-4 py-3 flex items-center justify-between border-b border-charcoal-700 shadow-sm z-20 relative backdrop-blur-sm">
                        <div className="flex items-center gap-2">
                            <span className="text-[9px] text-blue-500 font-mono leading-none tracking-widest uppercase">{t('forecast.aiModel')}</span>
                            <span className="text-xs text-blue-400 font-mono font-bold tracking-wider">{AI_MODEL_FORECAST}</span>
                        </div>
                    </div>
                    
                    {/* Scanning Border Effect */}
                    <div className="absolute top-0 left-0 w-full h-full border border-blue-500/10 pointer-events-none z-10 rounded-xl"></div>
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/20 to-transparent animate-scan opacity-30"></div>

                    {/* Terminal Body */}
                    <div className="p-6 max-h-[65vh] overflow-y-auto custom-scrollbar-dark bg-charcoal-900 relative z-10">
                        <ParsedResultDisplay rawText={analysisResult} />
                    </div>
                </div>
            ) : null}
         </div>
      </Modal>

      {/* Simulation Modal (Dark Mode for Sci-Fi feel) */}
      <Modal isOpen={isSimModalOpen} onClose={() => setIsSimModalOpen(false)} title={t('forecast.simTitle')} size="lg" variant="dark">
         {simResult && (
             <div className="p-4 space-y-6 font-sans">
                 <div className="text-center space-y-2 mb-6 animate-fade-in-up">
                    <Dices className="w-10 h-10 text-indigo-400 mx-auto mb-2" />
                    <h3 className="text-xl font-bold text-white">{t('forecast.simTitle')}</h3>
                    <p className="text-charcoal-400 text-sm max-w-md mx-auto">{t('forecast.simSubtitle')}</p>
                 </div>

                 <div className="flex items-center justify-between mb-2 px-2">
                     <div className="text-xs font-mono text-charcoal-400">
                         {t('forecast.capacityLimit')}: <span className="text-white font-bold">{simResult.baseCapacity}d</span>
                     </div>
                     <div className={`text-xs font-mono px-2 py-1 rounded ${simResult.overloadProbability > 50 ? 'bg-red-900/40 text-red-300 border border-red-800' : 'bg-green-900/40 text-green-300 border border-green-800'}`}>
                         {t('forecast.riskOfOverload')}: {simResult.overloadProbability.toFixed(1)}%
                     </div>
                 </div>

                 {/* Scenario Cards */}
                 <div className="grid grid-cols-3 gap-4">
                     {/* Low Load Scenario (P10 Volume) */}
                     <div className="bg-charcoal-800/50 border border-charcoal-700 rounded-xl p-4 text-center relative overflow-hidden group">
                         <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500/50"></div>
                         <div className="text-xs font-bold text-charcoal-400 uppercase tracking-wider mb-2">{t('forecast.simScenarioLow')}</div>
                         <div className="text-3xl font-bold text-white mb-1">{simResult.p10}d</div>
                         <div className="text-xs text-charcoal-500 mb-4">{t('forecast.p10')}</div>
                         
                         <div className="pt-3 border-t border-charcoal-700/50">
                             <div className="text-[10px] text-charcoal-400 uppercase">{t('forecast.netCap')}</div>
                             <div className={`text-lg font-bold ${(simResult.baseCapacity - simResult.p10) < 0 ? 'text-red-400' : 'text-green-400'}`}>
                                 {(simResult.baseCapacity - simResult.p10) > 0 ? '+' : ''}{simResult.baseCapacity - simResult.p10}d
                             </div>
                         </div>
                     </div>

                     {/* Likely Outcome (P50 Volume) */}
                     <div className="bg-charcoal-800 border border-indigo-500/30 rounded-xl p-4 text-center relative overflow-hidden transform scale-105 shadow-xl">
                         <div className="absolute top-0 left-0 right-0 h-1 bg-indigo-500"></div>
                         <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-2">{t('forecast.simScenarioMed')}</div>
                         <div className="text-4xl font-bold text-white mb-1">{simResult.p50}d</div>
                         <div className="text-xs text-charcoal-400 mb-4">{t('forecast.p50')}</div>
                         
                         <div className="pt-3 border-t border-charcoal-700">
                             <div className="text-[10px] text-charcoal-400 uppercase">{t('forecast.netCap')}</div>
                             <div className={`text-xl font-bold ${(simResult.baseCapacity - simResult.p50) < 0 ? 'text-red-400' : 'text-green-400'}`}>
                                 {(simResult.baseCapacity - simResult.p50) > 0 ? '+' : ''}{simResult.baseCapacity - simResult.p50}d
                             </div>
                         </div>
                     </div>

                     {/* High Load Scenario (P90 Volume) */}
                     <div className="bg-charcoal-800/50 border border-charcoal-700 rounded-xl p-4 text-center relative overflow-hidden">
                         <div className="absolute top-0 left-0 right-0 h-1 bg-orange-500/50"></div>
                         <div className="text-xs font-bold text-charcoal-400 uppercase tracking-wider mb-2">{t('forecast.simScenarioHigh')}</div>
                         <div className="text-3xl font-bold text-white mb-1">{simResult.p90}d</div>
                         <div className="text-xs text-charcoal-500 mb-4">{t('forecast.p90')}</div>
                         
                         <div className="pt-3 border-t border-charcoal-700/50">
                             <div className="text-[10px] text-charcoal-400 uppercase">{t('forecast.netCap')}</div>
                             <div className={`text-lg font-bold ${(simResult.baseCapacity - simResult.p90) < 0 ? 'text-red-400' : 'text-green-400'}`}>
                                 {(simResult.baseCapacity - simResult.p90) > 0 ? '+' : ''}{simResult.baseCapacity - simResult.p90}d
                             </div>
                         </div>
                     </div>
                 </div>

                 {/* Visualization Bar */}
                 <div className="mt-8 bg-charcoal-900 rounded-lg p-4 border border-charcoal-800 relative overflow-hidden">
                     <div className="flex justify-between items-end mb-2">
                         <div className="text-xs text-charcoal-500 font-mono">{t('forecast.simDistribution')} :: N=2000</div>
                         <div className="flex gap-4 text-[10px]">
                             <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-blue-500/50"></div><span className="text-charcoal-400">{t('forecast.safeZone')}</span></div>
                             <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500/50"></div><span className="text-charcoal-400">{t('forecast.overloadZone')}</span></div>
                         </div>
                     </div>

                     <div
                         role="img"
                         aria-label={t('forecast.simTitle')}
                         className="h-72"
                     >
                         <ResponsiveContainer width="100%" height="100%">
                             <BarChart data={simResult.histogram} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                                 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#363c45" />
                                 <XAxis
                                     dataKey="binStart"
                                     type="number"
                                     domain={simResult.minVol === simResult.maxVol
                                         ? [simResult.minVol, simResult.minVol + 1]
                                         : [simResult.minVol, simResult.maxVol]}
                                     tick={{ fontSize: 10, fill: '#647081' }}
                                     tickFormatter={(value: number) => `${value}d`}
                                 />
                                 <YAxis
                                     tick={{ fontSize: 10, fill: '#647081' }}
                                     width={40}
                                 />
                                 <Tooltip
                                     formatter={(value: any, _name: any, props: any) => {
                                         const start = props?.payload?.binStart ?? 0;
                                         const end = start + binWidth;
                                         return [value, `${start}d – ${end}d`];
                                     }}
                                     labelFormatter={() => ''}
                                     contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem', color: '#f3f4f6' }}
                                 />
                                 <ReferenceLine
                                     x={simResult.baseCapacity}
                                     stroke="#f3f4f6"
                                     strokeDasharray="4 2"
                                     label={{ value: `${t('forecast.capacityLimit')}: ${simResult.baseCapacity}d`, position: 'top', fill: '#f3f4f6', fontSize: 10 }}
                                 />
                                 <Bar
                                     dataKey="count"
                                     radius={[2, 2, 0, 0]}
                                     isAnimationActive={false}
                                 >
                                     {simResult.histogram.map((bin, i) => {
                                         const isOverload = bin.binStart > simResult.baseCapacity;
                                         return (
                                             <Cell key={`cell-${i}`} fill={isOverload ? '#ef4444' : '#3b82f6'} />
                                         );
                                     })}
                                 </Bar>
                             </BarChart>
                         </ResponsiveContainer>
                     </div>

                     <table className="sr-only">
                         <caption>{t('accessibility.chartData')}: {t('forecast.simTitle')}</caption>
                         <thead>
                             <tr>
                                 <th scope="col">{t('accessibility.bin')}</th>
                                 <th scope="col">{t('accessibility.count')}</th>
                             </tr>
                         </thead>
                         <tbody>
                             {simResult.histogram.map((bin, i) => {
                                 const binEnd = bin.binStart + binWidth;
                                 return (
                                     <tr key={i}>
                                         <td>{bin.binStart}d – {binEnd}d</td>
                                         <td>{bin.count}</td>
                                     </tr>
                                 );
                             })}
                         </tbody>
                     </table>
                 </div>
             </div>
         )}
      </Modal>
    </div>
  );
};
