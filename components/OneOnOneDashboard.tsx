

import React, { useState, useEffect } from 'react';
import { Employee, OneOnOneSession, Sentiment } from '../types';
import { Button } from './ui/Button';
import { useLanguage } from '../contexts/LanguageContext';
import { useSettings } from '../contexts/SettingsContext';
import { uid } from '../utils/uid';
import { Calendar, CheckCircle, Clock, Smile, Meh, Frown, Bot, Mic, FileText, Sparkles, Save, Archive, BrainCircuit, ArrowRight, Plus, X } from 'lucide-react';
import { generateCoachingAgenda, extractActionItems } from '../services/ai';
import { Modal } from './ui/Modal';
import { AsciiSpinner } from './ui/AsciiSpinner';
import { MOCK_1ON1S } from '../constants';

interface OneOnOneDashboardProps {
    employee: Employee;
    isOpen: boolean;
    onClose: () => void;
}

export const OneOnOneDashboard: React.FC<OneOnOneDashboardProps> = ({ employee, isOpen, onClose }) => {
    const { t, formatDate, language } = useLanguage();
    const { apiKey, isAiEnabled } = useSettings();
    
    // State
    const [sessions, setSessions] = useState<OneOnOneSession[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [isAiProcessing, setIsAiProcessing] = useState(false);

    // Initial Load (Simulation)
    useEffect(() => {
        if (isOpen) {
            // Filter mocks for this employee or load from storage
            const empSessions = MOCK_1ON1S.filter(s => s.employeeId === employee.id).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            setSessions(empSessions);
            if (empSessions.length > 0) setSelectedSessionId(empSessions[0].id);
        }
    }, [isOpen, employee.id]);

    const activeSession = sessions.find(s => s.id === selectedSessionId);
    
    // Find previous commitments (Elephant Memory)
    // Logic: Find the most recent *completed* session before the current active one
    const previousSession = activeSession 
        ? sessions.find(s => s.status === 'completed' && new Date(s.date) < new Date(activeSession.date))
        : null;

    const handleCreateSession = () => {
        const newSession: OneOnOneSession = {
            id: uid(),
            employeeId: employee.id,
            date: new Date().toISOString(),
            status: 'scheduled',
            sentiment: 'unknown',
            notes: '',
            commitments: [],
            agenda: []
        };
        setSessions([newSession, ...sessions]);
        setSelectedSessionId(newSession.id);
    };

    const handleUpdateSession = (updates: Partial<OneOnOneSession>) => {
        if (!activeSession) return;
        const updated = sessions.map(s => s.id === activeSession.id ? { ...s, ...updates } : s);
        setSessions(updated);
    };

    const handleGenerateAgenda = async () => {
        if (!activeSession || !isAiEnabled) return;
        setIsAiProcessing(true);
        try {
            const agendaText = await generateCoachingAgenda(activeSession.sentiment, employee.role, apiKey, language);
            // Parse bullets roughly
            const items = agendaText.split('\n').filter(line => line.trim().startsWith('-') || line.trim().startsWith('*')).map(l => l.replace(/^[-*]\s*/, ''));
            // If raw text returned without bullets, just split by newline
            const finalItems = items.length > 0 ? items : agendaText.split('\n').filter(l => l.trim().length > 0);
            
            handleUpdateSession({ agenda: finalItems });
        } catch (e) {
            console.error(e);
        } finally {
            setIsAiProcessing(false);
        }
    };

    const handleExtractActions = async () => {
        if (!activeSession || !activeSession.notes || !isAiEnabled) return;
        setIsAiProcessing(true);
        try {
            const actions = await extractActionItems(activeSession.notes, apiKey, language);
            handleUpdateSession({ commitments: [...activeSession.commitments, ...actions] });
        } catch (e) {
            console.error(e);
        } finally {
            setIsAiProcessing(false);
        }
    };

    const SentimentIcon = ({ sentiment, className = "w-5 h-5" }: { sentiment: Sentiment, className?: string }) => {
        switch (sentiment) {
            case 'great': return <Smile className={`${className} text-green-500`} />;
            case 'okay': return <Meh className={`${className} text-yellow-500`} />;
            case 'stressful': return <Frown className={`${className} text-red-500`} />;
            default: return <div className={`${className} rounded-full border border-dashed border-gray-400`} />;
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`${t('oneOnOne.title')} - ${employee.name}`} size="xl">
            <div className="flex flex-col h-[75vh]">
                {/* Top Header: Employee Context */}
                <div className="bg-charcoal-50 p-4 border-b border-charcoal-200 flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-lg">
                            {employee.name.charAt(0)}
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-charcoal-900 leading-tight">{employee.name}</h2>
                            <div className="text-xs text-charcoal-500">{employee.role} • {employee.location}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="text-right">
                            <div className="text-[10px] font-bold text-charcoal-400 uppercase tracking-wider">{t('oneOnOne.nextCheckIn')}</div>
                            <div className="text-sm font-medium text-charcoal-700">{t('oneOnOne.inTwoWeeks')}</div>
                        </div>
                        <Button onClick={handleCreateSession} size="sm" className="gap-1">
                            <Plus className="w-4 h-4" /> {t('oneOnOne.newSession')}
                        </Button>
                    </div>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    
                    {/* Sidebar: Session History */}
                    <div className="w-64 bg-charcoal-50/50 border-r border-charcoal-200 flex flex-col">
                        <div className="p-3 border-b border-charcoal-100 flex justify-between items-center">
                            <h3 className="text-xs font-bold text-charcoal-500 uppercase tracking-wider">{t('oneOnOne.scheduleTitle')}</h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-2">
                            {sessions.map(s => (
                                <button
                                    key={s.id}
                                    onClick={() => setSelectedSessionId(s.id)}
                                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                                        selectedSessionId === s.id 
                                        ? 'bg-white border-blue-300 shadow-md ring-1 ring-blue-100' 
                                        : 'bg-white border-charcoal-200 hover:border-charcoal-300'
                                    }`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${s.status === 'completed' ? 'bg-charcoal-100 text-charcoal-600' : 'bg-green-100 text-green-700'}`}>
                                            {s.status === 'completed' ? t('oneOnOne.past') : t('oneOnOne.upcoming')}
                                        </span>
                                        <SentimentIcon sentiment={s.sentiment} className="w-4 h-4" />
                                    </div>
                                    <div className="text-sm font-bold text-charcoal-800">{formatDate(new Date(s.date), 'MMM d, yyyy')}</div>
                                    {s.agenda.length > 0 && <div className="text-xs text-charcoal-500 mt-1 truncate">{t('oneOnOne.agendaItemsCount').replace('{{count}}', String(s.agenda.length))}</div>}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 flex flex-col bg-white overflow-hidden relative">
                        {activeSession ? (
                            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                                {/* Header / Pulse */}
                                <div className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-xl border border-blue-100 flex items-center justify-between">
                                    <div>
                                        <h2 className="text-xl font-bold text-charcoal-900 flex items-center gap-2">
                                            {formatDate(new Date(activeSession.date), 'EEEE, MMMM d, yyyy')}
                                            {activeSession.status === 'scheduled' && <span className="text-xs font-normal bg-white px-2 py-0.5 rounded-full border border-blue-200 text-blue-600">{t('oneOnOne.draft')}</span>}
                                        </h2>
                                        <div className="flex items-center gap-2 mt-1 text-sm text-charcoal-600">
                                            <span className="font-semibold">{t('oneOnOne.pulse')}:</span>
                                            <div className="flex items-center gap-1.5 bg-white px-2 py-0.5 rounded-full shadow-sm border border-blue-100">
                                                <SentimentIcon sentiment={activeSession.sentiment} />
                                                <span>
                                                    {activeSession.sentiment === 'great' ? t('oneOnOne.pulseGreat') :
                                                     activeSession.sentiment === 'okay' ? t('oneOnOne.pulseOkay') :
                                                     activeSession.sentiment === 'stressful' ? t('oneOnOne.pulseStress') :
                                                     t('oneOnOne.pulseUnknown')}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* Action Buttons */}
                                    <div className="flex gap-2">
                                        {activeSession.status === 'scheduled' && (
                                            <Button onClick={() => handleUpdateSession({ status: 'completed' })} size="sm" className="bg-green-600 hover:bg-green-700 text-white gap-2">
                                                <CheckCircle className="w-4 h-4" /> {t('oneOnOne.markComplete')}
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    {/* Column 1 & 2: Main Workspace */}
                                    <div className="lg:col-span-2 flex flex-col gap-6">
                                        
                                        {/* Agenda Section */}
                                        <div className="bg-white border border-charcoal-200 rounded-xl p-5 shadow-sm flex flex-col">
                                            <div className="flex justify-between items-center mb-4">
                                                <h3 className="text-sm font-bold text-charcoal-800 uppercase tracking-wider flex items-center gap-2">
                                                    <FileText className="w-4 h-4 text-blue-500" /> {t('oneOnOne.agenda')}
                                                </h3>
                                                {isAiEnabled && activeSession.agenda.length === 0 && (
                                                    <button onClick={handleGenerateAgenda} disabled={isAiProcessing} className="text-xs flex items-center gap-1 text-purple-600 hover:bg-purple-50 px-2 py-1 rounded transition-colors border border-purple-200">
                                                        {isAiProcessing ? <AsciiSpinner /> : <Sparkles className="w-3 h-3" />}
                                                        {t('oneOnOne.generateAgenda')}
                                                    </button>
                                                )}
                                            </div>
                                            <div className="flex-1">
                                                {activeSession.agenda.length > 0 ? (
                                                    <ul className="space-y-2 mb-3">
                                                        {activeSession.agenda.map((item, idx) => (
                                                            <li key={idx} className="flex gap-3 items-start group bg-charcoal-50/50 p-2 rounded-lg border border-charcoal-100">
                                                                <span className="mt-1 w-2 h-2 bg-blue-400 rounded-full flex-shrink-0" />
                                                                <span className="flex-1 text-sm text-charcoal-800">{item}</span>
                                                                <button onClick={() => {
                                                                    const newAgenda = activeSession.agenda.filter((_, i) => i !== idx);
                                                                    handleUpdateSession({ agenda: newAgenda });
                                                                }} className="opacity-0 group-hover:opacity-100 text-charcoal-400 hover:text-red-500 transition-opacity">
                                                                    <X className="w-4 h-4" />
                                                                </button>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <div className="p-6 text-center text-charcoal-400 text-sm italic bg-charcoal-50/50 rounded-lg border border-dashed border-charcoal-200 mb-3">
                                                        {t('oneOnOne.noAgendaItems')}
                                                    </div>
                                                )}
                                                <div className="flex gap-2 items-center bg-white border border-charcoal-200 rounded-lg p-1 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-400">
                                                     <Plus className="w-4 h-4 text-charcoal-400 ml-2" />
                                                     <input 
                                                        type="text" 
                                                        placeholder={t('oneOnOne.addAgendaItem')} 
                                                        className="flex-1 text-sm bg-transparent outline-none py-1.5 px-1"
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                const val = (e.target as HTMLInputElement).value;
                                                                if(val.trim()) {
                                                                    handleUpdateSession({ agenda: [...activeSession.agenda, val.trim()] });
                                                                    (e.target as HTMLInputElement).value = '';
                                                                }
                                                            }
                                                        }}
                                                     />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Notes Section */}
                                        <div className="bg-white border border-charcoal-200 rounded-xl p-5 shadow-sm flex flex-col flex-1">
                                            <div className="flex justify-between items-center mb-4">
                                                <h3 className="text-sm font-bold text-charcoal-800 uppercase tracking-wider flex items-center gap-2">
                                                    <FileText className="w-4 h-4 text-yellow-600" /> {t('oneOnOne.notes')}
                                                </h3>
                                                {isAiEnabled && activeSession.notes.length > 10 && (
                                                    <button onClick={handleExtractActions} disabled={isAiProcessing} className="text-xs flex items-center gap-1 text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition-colors border border-blue-200">
                                                        {isAiProcessing ? <AsciiSpinner /> : <BrainCircuit className="w-3 h-3" />}
                                                        {t('oneOnOne.extractActions')}
                                                    </button>
                                                )}
                                            </div>
                                            <div className="relative flex-1 flex flex-col">
                                                <textarea 
                                                    className="w-full flex-1 min-h-[160px] p-4 border border-charcoal-200 rounded-lg text-sm leading-relaxed focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none resize-none bg-yellow-50/30"
                                                    placeholder={t('oneOnOne.notesPlaceholder')}
                                                    value={activeSession.notes}
                                                    onChange={(e) => handleUpdateSession({ notes: e.target.value })}
                                                />
                                                <div className="absolute bottom-3 right-3">
                                                    <button className="p-2 text-charcoal-400 hover:text-blue-600 rounded-full hover:bg-blue-50 transition-colors shadow-sm bg-white border border-charcoal-100" title={t('oneOnOne.voiceDictation')}>
                                                        <Mic className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                    </div>

                                    {/* Column 3: The Elephant Memory & Commitments */}
                                    <div className="lg:col-span-1 flex flex-col gap-6">
                                        
                                        {/* Current Commitments */}
                                        <div className="bg-white rounded-xl p-5 border border-charcoal-200 shadow-sm flex-1 flex flex-col">
                                            <h3 className="text-sm font-bold text-charcoal-800 uppercase tracking-wider mb-4 flex items-center gap-2">
                                                <CheckCircle className="w-4 h-4 text-green-500" /> {t('oneOnOne.actionItems')}
                                            </h3>
                                            <div className="flex-1">
                                                <ul className="space-y-2 mb-3">
                                                    {activeSession.commitments.map((c, i) => (
                                                        <li key={i} className="text-xs text-charcoal-800 flex gap-2 items-start bg-charcoal-50 p-2.5 rounded-lg border border-charcoal-100">
                                                            <CheckCircle className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" />
                                                            <span className="flex-1 leading-relaxed">{c}</span>
                                                            <button onClick={() => {
                                                                const newComm = activeSession.commitments.filter((_, idx) => idx !== i);
                                                                handleUpdateSession({ commitments: newComm });
                                                            }} className="text-charcoal-300 hover:text-red-500">
                                                                <X className="w-3.5 h-3.5" />
                                                            </button>
                                                        </li>
                                                    ))}
                                                </ul>
                                                <div className="flex gap-2 items-center bg-white border border-charcoal-200 rounded-lg p-1 focus-within:ring-2 focus-within:ring-green-500/20 focus-within:border-green-400">
                                                    <Plus className="w-4 h-4 text-charcoal-400 ml-1" />
                                                     <input 
                                                        type="text" 
                                                        placeholder={t('oneOnOne.addActionItem')} 
                                                        className="flex-1 text-xs bg-transparent outline-none py-1.5 px-1"
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                const val = (e.target as HTMLInputElement).value;
                                                                if(val.trim()) {
                                                                    handleUpdateSession({ commitments: [...activeSession.commitments, val.trim()] });
                                                                    (e.target as HTMLInputElement).value = '';
                                                                }
                                                            }
                                                        }}
                                                     />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Elephant Memory */}
                                        <div className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl p-5 border border-yellow-200 shadow-sm relative overflow-hidden">
                                            <div className="absolute -top-4 -right-4 p-2 opacity-10">
                                                <BrainCircuit className="w-24 h-24 text-yellow-600" />
                                            </div>
                                            <div className="relative z-10">
                                                <h3 className="text-sm font-bold text-yellow-800 uppercase tracking-wider mb-1 flex items-center gap-2">
                                                    <Archive className="w-4 h-4" /> {t('oneOnOne.elephantMemory')}
                                                </h3>
                                                <p className="text-[10px] text-yellow-600 mb-4">{t('oneOnOne.elephantMemoryDesc')}</p>
                                                
                                                {previousSession && previousSession.commitments.length > 0 ? (
                                                    <ul className="space-y-2">
                                                        {previousSession.commitments.map((c, i) => (
                                                            <li key={i} className="text-xs text-charcoal-800 flex gap-2 items-start bg-white/80 p-2.5 rounded-lg border border-yellow-100 shadow-sm">
                                                                <input type="checkbox" className="mt-0.5 rounded text-yellow-600 focus:ring-yellow-500" />
                                                                <span className="flex-1 leading-relaxed">{c}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <div className="text-xs text-yellow-600/60 italic bg-white/50 p-3 rounded-lg border border-yellow-100/50">
                                                        {t('oneOnOne.noCommitments')}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-charcoal-400">
                                <Bot className="w-12 h-12 mb-2 opacity-50" />
                                <p>{t('oneOnOne.emptyState')}</p>
                                <Button onClick={handleCreateSession} className="mt-4">{t('oneOnOne.scheduleNew')}</Button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    );
};