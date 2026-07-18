
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Project, Assignment, StrategicGoal, StrategyPerspective } from '../types';
import { MOCK_GOALS, MOCK_NORTH_STARS } from '../constants';
import { useLanguage } from '../contexts/LanguageContext';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Target, Map as MapIcon, Bot, FileText, Send, Sparkles, AlertCircle, CheckCircle, Info, Plus } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { AI_MODEL_FORECAST } from '../services/ai';
import { useSettings } from '../contexts/SettingsContext';
import { uid } from '../utils/uid';
import { PageHeader } from './ui/PageHeader';

interface StrategyModuleProps {
  projects: Project[];
  assignments: Assignment[];
}

// Sub-components
interface StrategyMapProps {
    goals: StrategicGoal[];
    projects: Project[];
    onAddGoal: (goal: StrategicGoal) => void;
}

const StrategyMap: React.FC<StrategyMapProps> = ({ goals, projects, onAddGoal }) => {
    const { t } = useLanguage();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [perspective, setPerspective] = useState<StrategyPerspective>('financial');
    const perspectives: StrategyPerspective[] = ['financial', 'customer', 'internal', 'learning'];

    const getGoalHealth = (goal: StrategicGoal) => {
        const linkedProjects = projects.filter(p => goal.linkedProjectIds.includes(p.id));
        if (linkedProjects.some(p => p.health === 'critical')) return 'critical';
        if (linkedProjects.some(p => p.health === 'warning')) return 'warning';
        return 'good';
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;
        onAddGoal({
            id: uid(),
            title: title.trim(),
            perspective,
            linkedProjectIds: [],
        });
        setTitle('');
        setPerspective('financial');
        setIsModalOpen(false);
    };

    return (
        <>
        <div className="grid grid-cols-2 gap-6 h-full p-4 overflow-y-auto custom-scrollbar">
            {perspectives.map(p => (
                <div key={p} className="bg-white rounded-xl border border-charcoal-200 shadow-sm p-4 flex flex-col min-h-[250px] relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-indigo-500 opacity-20"></div>
                    <h3 className="text-sm font-bold text-charcoal-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                        {p === 'financial' && <span className="text-green-500">$</span>}
                        {p === 'customer' && <span className="text-blue-500">☺</span>}
                        {p === 'internal' && <span className="text-orange-500">⚙</span>}
                        {p === 'learning' && <span className="text-purple-500">🎓</span>}
                        {t(`strategy.perspectives.${p}`)}
                    </h3>
                    
                    <div className="flex-1 space-y-3">
                        {goals.filter(g => g.perspective === p).map(g => {
                            const health = getGoalHealth(g);
                            return (
                                <div key={g.id} className={`p-3 rounded-lg border shadow-sm transition-all hover:translate-x-1 cursor-pointer
                                    ${health === 'critical' ? 'bg-red-50 border-red-200 hover:border-red-300' : 
                                      health === 'warning' ? 'bg-yellow-50 border-yellow-200 hover:border-yellow-300' : 
                                      'bg-white border-charcoal-100 hover:border-blue-200'}
                                `}>
                                    <div className="flex justify-between items-start">
                                        <span className="font-medium text-charcoal-800 text-sm">{g.title}</span>
                                        {health === 'critical' && <AlertCircle className="w-4 h-4 text-red-500" />}
                                        {health === 'warning' && <Info className="w-4 h-4 text-yellow-500" />}
                                        {health === 'good' && <CheckCircle className="w-4 h-4 text-green-500" />}
                                    </div>
                                    <div className="mt-2 flex gap-1 flex-wrap">
                                        {g.linkedProjectIds.map(pid => {
                                            const proj = projects.find(p => p.id === pid);
                                            if (!proj) return null;
                                            return (
                                                <span key={pid} className="text-[10px] px-1.5 py-0.5 bg-charcoal-100 rounded text-charcoal-600 truncate max-w-[100px]">
                                                    {proj.name}
                                                </span>
                                            )
                                        })}
                                    </div>
                                </div>
                            )
                        })}
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="w-full py-2 border border-dashed border-charcoal-200 rounded-lg text-xs text-charcoal-400 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition-colors flex items-center justify-center gap-1"
                        >
                            <Plus className="w-3 h-3" /> {t('strategy.addGoal')}
                        </button>
                    </div>
                </div>
            ))}
        </div>

        <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={t('strategy.newGoal')} size="md">
            <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                    <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">
                        {t('strategy.goalTitle')}
                    </label>
                    <input
                        required
                        className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                    />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">
                        {t('strategy.goalPerspective')}
                    </label>
                    <select
                        className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-white"
                        value={perspective}
                        onChange={e => setPerspective(e.target.value as StrategyPerspective)}
                    >
                        {perspectives.map(p => (
                            <option key={p} value={p}>{t(`strategy.perspectives.${p}`)}</option>
                        ))}
                    </select>
                </div>
                <div className="flex justify-end gap-3 pt-2 border-t border-charcoal-100">
                    <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>
                        {t('strategy.cancel')}
                    </Button>
                    <Button type="submit">{t('strategy.saveGoal')}</Button>
                </div>
            </form>
        </Modal>
        </>
    );
};

const NorthStarAlignment: React.FC<{ projects: Project[], assignments: Assignment[] }> = ({ projects, assignments }) => {
    const { t } = useLanguage();
    
    const data = useMemo(() => {
        // Calculate volume per metric
        const metrics = MOCK_NORTH_STARS.map(ns => {
            const linkedProjects = projects.filter(p => p.northStarMetricId === ns.id);
            const volume = linkedProjects.reduce((sum, p) => {
                 return sum + (p.volume || 0);
            }, 0);

            return {
                ...ns,
                volume,
                projects: linkedProjects
            };
        });

        // Add "Maintenance / Unaligned" category
        const unalignedProjects = projects.filter(p => !p.northStarMetricId && p.status === 'active');
        const unalignedVolume = unalignedProjects.reduce((sum, p) => sum + (p.volume || 0), 0);

        const allItems = [
            ...metrics,
            { id: 'unaligned', name: t('strategy.maintenance'), description: '', color: '#94a3b8', volume: unalignedVolume, projects: unalignedProjects }
        ];

        const totalVolume = allItems.reduce((sum, d) => sum + d.volume, 0);

        // Precompute sunburst sectors (keep render pure — no mutation during render)
        const EPSILON = 1e-4;
        const gap = 0.02;
        const pathItems = totalVolume > 0 ? allItems.filter(m => m.volume > 0) : [];

        let startAngle = 0;
        const sectors = pathItems.map(metric => {
            const sweep = (metric.volume / totalVolume) * 2 * Math.PI;
            // Clamp full-circle sweep so the SVG arc doesn't degenerate (end === start)
            const clampedSweep = Math.min(sweep, 2 * Math.PI - EPSILON);
            const endAngle = startAngle + clampedSweep;

            const metricSector = {
                id: metric.id,
                name: metric.name,
                color: metric.color,
                volume: metric.volume,
                startAngle,
                endAngle,
            };

            let projStart = startAngle;
            const projectSectors = metric.projects
                .filter(p => (p.volume || 0) > 0)
                .map(p => {
                    const pVolume = p.volume || 0;
                    const pSweep = (pVolume / metric.volume) * clampedSweep;
                    const pEnd = projStart + pSweep;
                    const sector = {
                        id: p.id,
                        name: p.name,
                        color: metric.color,
                        volume: pVolume,
                        startAngle: projStart + gap / 2,
                        endAngle: Math.max(projStart + gap / 2, pEnd - gap / 2),
                    };
                    projStart = pEnd;
                    return sector;
                });

            startAngle = endAngle;
            return { metricSector, projectSectors };
        });

        return { totalVolume, allItems, sectors };
    }, [projects, assignments, t]);

    const { totalVolume, allItems, sectors } = data;

    // Simple SVG Sunburst (Concentric Donuts)
    const radiusOuter = 140;
    const radiusInner = 90;
    const radiusCenter = 50;

    const createSector = (start: number, end: number, rIn: number, rOut: number) => {
        const x1 = 150 + rOut * Math.cos(start);
        const y1 = 150 + rOut * Math.sin(start);
        const x2 = 150 + rOut * Math.cos(end);
        const y2 = 150 + rOut * Math.sin(end);
        
        const x3 = 150 + rIn * Math.cos(end);
        const y3 = 150 + rIn * Math.sin(end);
        const x4 = 150 + rIn * Math.cos(start);
        const y4 = 150 + rIn * Math.sin(start);

        const largeArc = end - start > Math.PI ? 1 : 0;

        return `M ${x1} ${y1} A ${rOut} ${rOut} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${rIn} ${rIn} 0 ${largeArc} 0 ${x4} ${y4} Z`;
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex-none p-4">
                 <h3 className="text-lg font-bold text-charcoal-800">{t('strategy.sunburstTitle')}</h3>
                 <p className="text-sm text-charcoal-500">{t('strategy.sunburstSubtitle')}</p>
            </div>
            
            <div className="flex-1 flex items-center justify-center p-4 relative">
                <svg viewBox="0 0 300 300" className="w-full max-w-[500px] h-auto drop-shadow-xl">
                    {/* Center Text */}
                    <circle cx="150" cy="150" r={radiusCenter} fill="white" className="drop-shadow-sm" />
                    <text x="150" y="145" textAnchor="middle" fontSize="10" className="fill-charcoal-500 font-medium uppercase tracking-widest">
                        {t('strategy.totalVolume')}
                    </text>
                    <text x="150" y="165" textAnchor="middle" fontSize="16" className="fill-charcoal-900 font-bold">
                        {totalVolume}d
                    </text>

                    {/* Rings */}
                    {sectors.map(({ metricSector, projectSectors }) => (
                        <g key={metricSector.id}>
                            <path
                                d={createSector(metricSector.startAngle, metricSector.endAngle, radiusCenter + 5, radiusInner)}
                                fill={metricSector.color}
                                className="stroke-white stroke-2 hover:brightness-110 transition-all cursor-pointer shadow-sm"
                            >
                                <title>{metricSector.name}: {Math.round((metricSector.volume / totalVolume) * 100)}%</title>
                            </path>
                            {projectSectors.map(s => (
                                <path
                                    key={s.id}
                                    d={createSector(s.startAngle, s.endAngle, radiusInner + 5, radiusOuter)}
                                    fill={s.color}
                                    className="opacity-60 hover:opacity-100 transition-opacity cursor-pointer stroke-white stroke-1"
                                >
                                    <title>{s.name} ({s.volume}d)</title>
                                </path>
                            ))}
                        </g>
                    ))}
                </svg>
            </div>
            
            <div className="flex flex-wrap justify-center gap-4 p-4 border-t border-charcoal-100 bg-charcoal-50/50">
                {allItems.map(m => (
                    <div key={m.id} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: m.color }}></div>
                        <span className="text-xs font-medium text-charcoal-700">{m.name}</span>
                        <span className="text-xs text-charcoal-400 font-mono">({totalVolume > 0 ? Math.round((m.volume / totalVolume) * 100) : 0}%)</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const StrategyCoPilot: React.FC = () => {
    const { t, language } = useLanguage();
    const { apiKey, isAiEnabled, openSettings } = useSettings();
    const [messages, setMessages] = useState<{role: 'user'|'model'|'system', text: string}[]>([
        { role: 'model', text: t('strategy.greeting') }
    ]);
    const [input, setInput] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSend = async (e?: React.FormEvent, manualInput?: string) => {
        if (e) e.preventDefault();
        const textToSend = manualInput || input;
        if (!textToSend.trim()) return;

        if (!isAiEnabled || !apiKey) {
             setMessages(prev => [...prev, { role: 'system', text: t('strategy.aiDisabled') }]);
             return;
        }

        const userMsg = textToSend;
        setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
        setInput('');
        setIsGenerating(true);

        try {
            const ai = new GoogleGenAI({ apiKey });
            
            // Build Context
            const history = messages.filter(m => m.role !== 'system').map(m => ({
                role: m.role,
                parts: [{ text: m.text }]
            }));
            
            // System Prompt
            const systemPrompt = `
                You are an expert Strategy Consultant AI. Your goal is to interview the user to build a company strategy document.
                Current Language: ${language}.
                
                Phase 1: Interview. Ask ONE relevant strategic question at a time (e.g., about SWOT, Goals, Risks, Differentiation).
                Phase 2: If the user asks to "Generate Document", synthesize all previous answers into a structured Markdown Strategy Document.
                
                Be professional, concise, and insightful.
            `;

            const chat = ai.chats.create({
                model: AI_MODEL_FORECAST,
                config: { systemInstruction: systemPrompt },
                history: history
            });

            const result = await chat.sendMessage({ message: userMsg });
            setMessages(prev => [...prev, { role: 'model', text: result.text ?? '' }]);
        } catch (error) {
            console.error('Error connecting to AI Consultant:', error);
            setMessages(prev => [...prev, { role: 'system', text: t('strategy.aiError') }]);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-charcoal-900 text-gray-200 rounded-xl overflow-hidden border border-charcoal-700 shadow-2xl relative">
            {/* Header */}
            <div className="bg-charcoal-950 p-4 border-b border-charcoal-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center border border-blue-500/30">
                        <Bot className="w-6 h-6 text-blue-400" />
                    </div>
                    <div>
                        <h3 className="font-bold text-white">{t('strategy.coPilotTitle')}</h3>
                        <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                            <span className="text-xs text-green-400 font-mono tracking-wider">{t('strategy.interviewMode')}</span>
                        </div>
                    </div>
                </div>
                {!isAiEnabled && (
                    <button onClick={openSettings} className="text-xs text-red-400 border border-red-900 bg-red-900/20 px-2 py-1 rounded hover:bg-red-900/40">
                        {t('strategy.configureAi')}
                    </button>
                )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar-dark bg-gradient-to-b from-charcoal-900 to-charcoal-950">
                {messages.map((m, i) => (
                    <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${m.role === 'user' ? 'bg-indigo-600' : m.role === 'system' ? 'bg-red-900' : 'bg-charcoal-800 border border-charcoal-700'}`}>
                            {m.role === 'user' ? <div className="text-xs font-bold">YOU</div> : m.role === 'system' ? <AlertCircle className="w-4 h-4 text-red-400" /> : <Sparkles className="w-4 h-4 text-blue-400" />}
                        </div>
                        <div className={`p-3 rounded-lg text-sm max-w-[80%] leading-relaxed shadow-sm ${
                            m.role === 'user' ? 'bg-indigo-600 text-white' : 
                            m.role === 'system' ? 'bg-red-900/30 border border-red-800 text-red-200' :
                            'bg-charcoal-800 border border-charcoal-700 text-gray-300'
                        }`}>
                            {m.role === 'model' ? (
                                <div className="markdown-prose">{m.text}</div> // Simplified rendering
                            ) : m.text}
                        </div>
                    </div>
                ))}
                {isGenerating && (
                    <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-charcoal-800 border border-charcoal-700 flex items-center justify-center">
                            <Sparkles className="w-4 h-4 text-blue-400 animate-pulse" />
                        </div>
                        <div className="flex items-center gap-1 h-8">
                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"></span>
                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 bg-charcoal-950 border-t border-charcoal-800">
                <form onSubmit={handleSend} className="relative">
                    <input 
                        className="w-full bg-charcoal-900 text-white pl-4 pr-12 py-3 rounded-xl border border-charcoal-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none placeholder-charcoal-500 transition-all"
                        placeholder={t('strategy.startInterview')}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        disabled={isGenerating}
                    />
                    <button 
                        type="submit"
                        disabled={!input.trim() || isGenerating}
                        className="absolute right-2 top-2 p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </form>
                <div className="flex justify-center gap-2 mt-2">
                    <button 
                        onClick={() => { handleSend(undefined, "Generate Strategy Document"); }}
                        className="text-[10px] text-charcoal-500 hover:text-blue-400 flex items-center gap-1 transition-colors"
                    >
                        <FileText className="w-3 h-3" /> {t('strategy.generateDoc')}
                    </button>
                </div>
            </div>
        </div>
    );
};

// Main Module Container
export const StrategyModule: React.FC<StrategyModuleProps> = ({ projects, assignments }) => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'map' | 'northstar' | 'copilot'>('map');
  const [goals, setGoals] = useState<StrategicGoal[]>(MOCK_GOALS);

  const handleAddGoal = (goal: StrategicGoal) => {
    setGoals(prev => [...prev, goal]);
  };

  return (
    <div className="h-full flex flex-col bg-gray-50/50 overflow-hidden relative tech-pattern">
       <div className="p-6 pb-2">
           <PageHeader title={t('strategy.title')} subtitle={t('strategy.subtitle')} />

           {/* Tabs */}
           <div className="max-w-7xl mx-auto flex gap-1 bg-charcoal-100/50 p-1 rounded-xl w-fit">
               <button 
                  onClick={() => setActiveTab('map')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'map' ? 'bg-white shadow text-blue-700' : 'text-charcoal-500 hover:text-charcoal-800'}`}
               >
                   <MapIcon className="w-4 h-4" /> {t('strategy.strategyMap')}
               </button>
               <button 
                  onClick={() => setActiveTab('northstar')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'northstar' ? 'bg-white shadow text-blue-700' : 'text-charcoal-500 hover:text-charcoal-800'}`}
               >
                   <Target className="w-4 h-4" /> {t('strategy.northStar')}
               </button>
               <button 
                  onClick={() => setActiveTab('copilot')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'copilot' ? 'bg-white shadow text-blue-700' : 'text-charcoal-500 hover:text-charcoal-800'}`}
               >
                   <Bot className="w-4 h-4" /> {t('strategy.aiCoPilot')}
               </button>
           </div>
       </div>

       <div className="flex-1 overflow-hidden p-6 pt-0">
           <div className="max-w-7xl mx-auto h-full">
               {activeTab === 'map' && (
                   <div className="h-full bg-white/50 backdrop-blur-sm rounded-2xl border border-charcoal-200 shadow-inner animate-fade-in-up">
                       <StrategyMap goals={goals} projects={projects} onAddGoal={handleAddGoal} />
                   </div>
               )}
               
               {activeTab === 'northstar' && (
                   <div className="h-full bg-white/50 backdrop-blur-sm rounded-2xl border border-charcoal-200 shadow-inner animate-fade-in-up flex items-center justify-center">
                       <NorthStarAlignment projects={projects} assignments={assignments} />
                   </div>
               )}
               
               {activeTab === 'copilot' && (
                   <div className="h-full max-w-4xl mx-auto animate-fade-in-up">
                       <StrategyCoPilot />
                   </div>
               )}
           </div>
       </div>
    </div>
  );
};
