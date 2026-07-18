

import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { Assignment, Project, Absence, Employee, Sentiment } from '../types';
import { format, isSameDay, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Briefcase, Clock, TrendingUp, Smile, Frown, Meh, Folder, HeartHandshake } from 'lucide-react';
import { PASTEL_VARIANTS, MOCK_HOLIDAYS, MOCK_1ON1S } from '../constants';

interface MyOverviewProps {
  assignments: Assignment[];
  projects: Project[];
  absences: Absence[];
  employees?: Employee[]; // List of all employees to look up target
  targetEmployeeId?: string | null; // If set, view this employee instead of self
}

export const MyOverview: React.FC<MyOverviewProps> = ({ assignments, projects, absences, employees = [], targetEmployeeId }) => {
  const { user } = useAuth();
  const { t, formatDate } = useLanguage();
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [pulseSubmitted, setPulseSubmitted] = useState(false);

  // Determine which employee context to show
  // If targetEmployeeId is provided, try to find that employee.
  // Fallback to the logged-in user.
  const isSelf = !targetEmployeeId || targetEmployeeId === user.employeeId;
  
  const targetEmployee = targetEmployeeId 
    ? employees.find(e => e.id === targetEmployeeId) 
    : null;

  // Data needed for display
  const displayId = isSelf ? user.employeeId : targetEmployeeId;
  const displayName = isSelf ? t('myOverview.title') : t('myOverview.employeeOverview').replace('{{name}}', targetEmployee?.name || '');
  const displayAvatar = isSelf ? user.avatar : targetEmployee?.avatar;
  const displayRole = isSelf ? user.role : targetEmployee?.role;

  // Filter data for the specific employee
  const myAssignments = assignments.filter(a => a.employeeId === displayId);
  const myProjectsIds = Array.from(new Set(myAssignments.map(a => a.projectId)));
  const myProjects = projects.filter(p => myProjectsIds.includes(p.id));

  // Find next upcoming 1:1
  const my1on1s = MOCK_1ON1S.filter(s => s.employeeId === displayId && s.status === 'scheduled').sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const nextSession = my1on1s.length > 0 ? my1on1s[0] : null;

  // Current Week Calendar
  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // Stats
  // Calculate unique planned days in current month (simplified)
  const currentMonth = format(today, 'yyyy-MM');
  const daysThisMonth = myAssignments.filter(a => a.date.startsWith(currentMonth)).length;
  const utilization = Math.min(100, Math.round((daysThisMonth / 20) * 100)); // Rough estimate based on 20 working days

  // Mock submission handler for pulse
  const handlePulseSubmit = (sentiment: Sentiment) => {
      // In a real app, this would update backend state
      setPulseSubmitted(true);
      if(nextSession) nextSession.sentiment = sentiment; // Update local mock
  };

  return (
    <div className="h-full overflow-auto bg-gray-50/50 p-6 custom-scrollbar">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex justify-between items-end">
          <div className="flex items-center gap-4">
             {displayAvatar && <img src={displayAvatar} className="w-16 h-16 rounded-full border-2 border-white shadow-sm" alt="Profile" />}
             <div>
                <h1 className="text-2xl font-bold text-charcoal-900">{displayName}</h1>
                <p className="text-charcoal-500">
                    {isSelf ? t('myOverview.subtitle') : displayRole}
                </p>
             </div>
          </div>
          {isSelf && (
              <Button onClick={() => setIsStatusModalOpen(true)} className="gap-2 shadow-sm">
                 <TrendingUp className="w-4 h-4" /> {t('myOverview.reportStatus')}
              </Button>
          )}
        </div>

        {/* Pulse Check Widget (Only for Self) */}
        {isSelf && nextSession && !pulseSubmitted && nextSession.sentiment === 'unknown' && (
            <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-100 rounded-xl p-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6 animate-fade-in-up">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-indigo-600 shadow-sm border border-indigo-100">
                        <HeartHandshake className="w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-indigo-900">{t('myOverview.pulseCheckTitle')}</h3>
                        <p className="text-sm text-indigo-700">{t('myOverview.pulseCheckDesc')} <span className="font-semibold">{formatDate(new Date(nextSession.date), 'MMM d')}</span></p>
                    </div>
                </div>
                <div className="flex gap-4">
                    <button onClick={() => handlePulseSubmit('great')} className="flex flex-col items-center gap-1 group">
                        <div className="w-10 h-10 rounded-full bg-white border border-green-200 flex items-center justify-center text-green-500 group-hover:scale-110 group-hover:bg-green-50 transition-all shadow-sm">
                            <Smile className="w-6 h-6" />
                        </div>
                        <span className="text-[10px] font-bold text-green-700 uppercase">{t('myOverview.feelingGood')}</span>
                    </button>
                    <button onClick={() => handlePulseSubmit('okay')} className="flex flex-col items-center gap-1 group">
                        <div className="w-10 h-10 rounded-full bg-white border border-yellow-200 flex items-center justify-center text-yellow-500 group-hover:scale-110 group-hover:bg-yellow-50 transition-all shadow-sm">
                            <Meh className="w-6 h-6" />
                        </div>
                        <span className="text-[10px] font-bold text-yellow-700 uppercase">{t('myOverview.bored')}</span>
                    </button>
                    <button onClick={() => handlePulseSubmit('stressful')} className="flex flex-col items-center gap-1 group">
                        <div className="w-10 h-10 rounded-full bg-white border border-red-200 flex items-center justify-center text-red-500 group-hover:scale-110 group-hover:bg-red-50 transition-all shadow-sm">
                            <Frown className="w-6 h-6" />
                        </div>
                        <span className="text-[10px] font-bold text-red-700 uppercase">{t('myOverview.overwhelmed')}</span>
                    </button>
                </div>
            </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-5 rounded-xl border border-charcoal-200 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                    <Clock className="w-6 h-6" />
                </div>
                <div>
                    <div className="text-2xl font-bold text-charcoal-900">{daysThisMonth}d</div>
                    <div className="text-sm text-charcoal-500">{t('myOverview.daysPlaned')}</div>
                </div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-charcoal-200 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-purple-50 flex items-center justify-center text-purple-600">
                    <Briefcase className="w-6 h-6" />
                </div>
                <div>
                    <div className="text-2xl font-bold text-charcoal-900">{myProjects.length}</div>
                    <div className="text-sm text-charcoal-500">{t('myOverview.myProjects')}</div>
                </div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-charcoal-200 shadow-sm flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${utilization > 100 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                    <TrendingUp className="w-6 h-6" />
                </div>
                <div>
                    <div className={`text-2xl font-bold ${utilization > 100 ? 'text-red-600' : 'text-charcoal-900'}`}>{utilization}%</div>
                    <div className="text-sm text-charcoal-500">{t('myOverview.utilization')}</div>
                </div>
            </div>
        </div>

        {/* My Projects List */}
        <div className="bg-white rounded-xl border border-charcoal-200 shadow-sm overflow-hidden">
             <div className="px-6 py-4 border-b border-charcoal-100 bg-charcoal-50/50">
                 <h3 className="font-semibold text-charcoal-800">{t('myOverview.myProjects')}</h3>
             </div>
             <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                 {myProjects.length > 0 ? myProjects.map(p => (
                     <div key={p.id} className="p-4 rounded-lg border border-charcoal-100 flex items-center justify-between hover:border-blue-200 hover:bg-blue-50/30 transition-colors">
                         <div className="flex items-center gap-3">
                             <Folder className={`w-5 h-5 ${PASTEL_VARIANTS[p.color].text}`} />
                             <div>
                                 <div className="font-medium text-charcoal-900">{p.name}</div>
                                 <div className="text-xs text-charcoal-500">{p.client} • {p.status}</div>
                             </div>
                         </div>
                         <div className="text-xs font-mono text-charcoal-400 bg-charcoal-50 px-2 py-1 rounded">
                             {t('myOverview.assignedDays').replace('{{count}}', String(assignments.filter(a => a.projectId === p.id && a.employeeId === displayId).length))}
                         </div>
                     </div>
                 )) : (
                    <div className="text-charcoal-400 text-sm italic col-span-2 text-center py-4">{t('myOverview.noProjectsAssigned')}</div>
                 )}
             </div>
        </div>

        {/* Upcoming Week Calendar Strip */}
        <div className="bg-white rounded-xl border border-charcoal-200 shadow-sm overflow-hidden">
             <div className="px-6 py-4 border-b border-charcoal-100 bg-charcoal-50/50 flex justify-between items-center">
                 <h3 className="font-semibold text-charcoal-800">{t('myOverview.upcoming')}</h3>
                 <span className="text-xs font-mono text-charcoal-500">{formatDate(today, 'MMMM yyyy')}</span>
             </div>
             <div className="p-6">
                 <div className="grid grid-cols-7 gap-4">
                     {weekDays.map(day => {
                         const dateStr = format(day, 'yyyy-MM-dd');
                         const isToday = isSameDay(day, today);
                         const dayAssignments = myAssignments.filter(a => a.date === dateStr);
                         const dayAbsence = absences.find(a => a.employeeId === displayId && a.date === dateStr);
                         // Check holiday for the specific employee location
                         const empLocation = isSelf ? 'DE' : targetEmployee?.location || 'DE'; // Simplified, should check actual user loc
                         const isHoliday = MOCK_HOLIDAYS.some(h => h.date === dateStr && (h.location === 'ALL' || h.location === empLocation));

                         return (
                             <div key={dateStr} className={`flex flex-col gap-2 p-2 rounded-lg border min-h-[120px] ${isToday ? 'border-blue-300 ring-1 ring-blue-100 bg-blue-50/20' : 'border-charcoal-100 bg-charcoal-50/20'}`}>
                                 <div className="text-center pb-2 border-b border-charcoal-100/50">
                                     <div className={`text-xs uppercase font-bold ${isToday ? 'text-blue-600' : 'text-charcoal-400'}`}>{formatDate(day, 'EEE')}</div>
                                     <div className={`text-sm font-semibold ${isToday ? 'text-blue-700' : 'text-charcoal-700'}`}>{formatDate(day, 'd')}</div>
                                 </div>
                                 
                                 <div className="flex flex-col gap-1 flex-1">
                                     {isHoliday && (
                                         <div className="text-[10px] bg-red-50 text-red-600 px-1 py-0.5 rounded text-center border border-red-100">
                                             {t('myOverview.publicHoliday')}
                                         </div>
                                     )}
                                     {dayAbsence && (
                                         <div className="text-[10px] bg-gray-100 text-charcoal-600 px-1 py-0.5 rounded text-center border border-gray-200 italic">
                                             {dayAbsence.type}
                                         </div>
                                     )}
                                     {dayAssignments.map(a => {
                                         const proj = projects.find(p => p.id === a.projectId);
                                         if(!proj) return null;
                                         return (
                                             <div key={a.id} className={`text-[10px] px-1.5 py-1 rounded truncate border ${PASTEL_VARIANTS[proj.color].bg} ${PASTEL_VARIANTS[proj.color].text} ${PASTEL_VARIANTS[proj.color].border}`}>
                                                 {proj.name}
                                             </div>
                                         )
                                     })}
                                 </div>
                             </div>
                         );
                     })}
                 </div>
             </div>
        </div>

      </div>

      {/* Report Status Modal */}
      {isSelf && (
          <Modal isOpen={isStatusModalOpen} onClose={() => setIsStatusModalOpen(false)} title={t('myOverview.statusReportTitle')}>
              <div className="space-y-6">
                  <div>
                      <label className="block text-sm font-medium text-charcoal-700 mb-3">{t('myOverview.mood')}</label>
                      <div className="flex gap-4 justify-center">
                          <button className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-green-50 text-charcoal-400 hover:text-green-600 transition-colors focus:ring-2 ring-green-500">
                              <Smile className="w-8 h-8" />
                              <span className="text-xs">{t('myOverview.feelingGood')}</span>
                          </button>
                          <button className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-yellow-50 text-charcoal-400 hover:text-yellow-600 transition-colors focus:ring-2 ring-yellow-500">
                              <Meh className="w-8 h-8" />
                              <span className="text-xs">{t('myOverview.bored')}</span>
                          </button>
                          <button className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-red-50 text-charcoal-400 hover:text-red-600 transition-colors focus:ring-2 ring-red-500">
                              <Frown className="w-8 h-8" />
                              <span className="text-xs">{t('myOverview.overwhelmed')}</span>
                          </button>
                      </div>
                  </div>

                  <div>
                      <label className="block text-sm font-medium text-charcoal-700 mb-2">{t('projects.notes')}</label>
                      <textarea className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" rows={3} placeholder={t('myOverview.achievedPlaceholder')} />
                  </div>
                  
                  <div>
                      <label className="block text-sm font-medium text-charcoal-700 mb-2">{t('myOverview.blockers')}</label>
                      <textarea className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500" rows={2} placeholder={t('myOverview.blockers')} />
                  </div>

                  <div className="flex justify-end pt-4 gap-3">
                      <Button variant="ghost" onClick={() => setIsStatusModalOpen(false)}>{t('planner.cancel')}</Button>
                      <Button onClick={() => { alert(t('myOverview.reportSent')); setIsStatusModalOpen(false); }}>{t('myOverview.submit')}</Button>
                  </div>
              </div>
          </Modal>
      )}
    </div>
  );
};