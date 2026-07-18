

import React, { useState } from 'react';
import { Project } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { useSettings } from '../contexts/SettingsContext';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { PASTEL_VARIANTS } from '../constants';
import { GoogleGenAI } from "@google/genai";
import { Plus, Target, DollarSign, TrendingUp, Search, Briefcase, Zap, AlertCircle, Sparkles } from 'lucide-react';
import { AsciiSpinner } from './ui/AsciiSpinner';
import { uid } from '../utils/uid';
import { parseBudget, formatEuro } from '../utils/money';

interface SalesPipelineProps {
  projects: Project[];
  onUpdateProjects: (projects: Project[]) => void;
}

export const SalesPipeline: React.FC<SalesPipelineProps> = ({ projects, onUpdateProjects }) => {
  const { t } = useLanguage();
  const { apiKey, isAiEnabled } = useSettings();
  const [isAddLeadOpen, setIsAddLeadOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  
  // AI State
  const [trendsPrompt, setTrendsPrompt] = useState('');
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Stats
  const pipelineProjects = projects.filter(p => p.status === 'opportunity' || p.status === 'active');
  const totalValue = pipelineProjects.reduce((sum, p) => sum + (parseBudget(p.budget) ?? 0), 0);
  const weightedValue = pipelineProjects.reduce((sum, p) => sum + ((parseBudget(p.budget) ?? 0) * ((p.probability || 0) / 100)), 0);
  const activeLeadsCount = pipelineProjects.filter(p => p.status === 'opportunity').length;

  // Group by Stage
  const stages: {id: string, label: string, color: string}[] = [
      { id: 'lead', label: t('sales.stages.lead'), color: 'bg-gray-100 border-gray-200' },
      { id: 'qualified', label: t('sales.stages.qualified'), color: 'bg-blue-50 border-blue-200' },
      { id: 'proposal', label: t('sales.stages.proposal'), color: 'bg-purple-50 border-purple-200' },
      { id: 'negotiation', label: t('sales.stages.negotiation'), color: 'bg-orange-50 border-orange-200' }
  ];

  const handleStageChange = (project: Project, newStage: any) => {
      const updated = projects.map(p => p.id === project.id ? { ...p, stage: newStage } : p);
      onUpdateProjects(updated);
  };

  const handleAddLead = (e: React.FormEvent) => {
      e.preventDefault();
      // Logic handled in ManageProjects mostly, but here we can add a quick lead
      // For simplicity, let's just create a basic one
      const form = e.target as HTMLFormElement;
      const formData = new FormData(form);
      
      const newProject: Project = {
          id: uid(),
          name: formData.get('name') as string,
          client: formData.get('client') as string,
          status: 'opportunity',
          stage: 'lead',
          probability: 20,
          color: 'gray',
          budget: formData.get('budget') as string,
          volume: 20
      };
      
      onUpdateProjects([...projects, newProject]);
      setIsAddLeadOpen(false);
  };

  const analyzeTrends = async () => {
      if (!apiKey || !isAiEnabled) return;
      setIsAnalyzing(true);
      setAiResult(null);
      
      try {
          const ai = new GoogleGenAI({ apiKey });
          const prompt = `
            Act as a Business Development Consultant.
            Analyze market trends for: "${trendsPrompt || 'General Tech Industry in DACH region'}".
            Suggest 3 potential project opportunities that a software consultancy could pitch.
            Format as a list. Be concise.
          `;
          
          const response = await ai.models.generateContent({
              model: 'gemini-3-pro-preview',
              contents: prompt
          });
          
          setAiResult(response.text ?? null);
      } catch (e) {
          setAiResult("Error analyzing trends. Check API Key.");
      } finally {
          setIsAnalyzing(false);
      }
  };

  return (
    <div className="h-full overflow-auto bg-gray-50/50 p-6 custom-scrollbar">
      <div className="max-w-7xl mx-auto space-y-8">
          
          {/* Header */}
          <div className="flex justify-between items-end">
             <div>
                <h1 className="text-2xl font-semibold text-charcoal-900 tracking-tight flex items-center gap-3">
                    <Target className="w-7 h-7 text-orange-600" />
                    {t('sales.title')}
                </h1>
                <p className="text-charcoal-500 mt-1">{t('sales.subtitle')}</p>
             </div>
             <div className="flex gap-3">
                 <Button onClick={() => setIsAiModalOpen(true)} variant="secondary" className="gap-2 bg-white text-purple-700 border-purple-200 hover:bg-purple-50">
                     <Sparkles className="w-4 h-4" /> {t('sales.marketTrends')}
                 </Button>
                 <Button onClick={() => setIsAddLeadOpen(true)} className="gap-2 bg-orange-600 hover:bg-orange-700 text-white">
                     <Plus className="w-4 h-4" /> {t('sales.addLead')}
                 </Button>
             </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-5 rounded-xl border border-charcoal-200 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center text-green-600">
                      <DollarSign className="w-6 h-6" />
                  </div>
                  <div>
                      <div className="text-2xl font-bold text-charcoal-900">€{(totalValue/1000).toFixed(0)}k</div>
                      <div className="text-sm text-charcoal-500">{t('sales.pipelineValue')}</div>
                  </div>
              </div>
              <div className="bg-white p-5 rounded-xl border border-charcoal-200 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                      <TrendingUp className="w-6 h-6" />
                  </div>
                  <div>
                      <div className="text-2xl font-bold text-charcoal-900">€{(weightedValue/1000).toFixed(0)}k</div>
                      <div className="text-sm text-charcoal-500">{t('sales.weightedValue')}</div>
                  </div>
              </div>
              <div className="bg-white p-5 rounded-xl border border-charcoal-200 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center text-orange-600">
                      <Briefcase className="w-6 h-6" />
                  </div>
                  <div>
                      <div className="text-2xl font-bold text-charcoal-900">{activeLeadsCount}</div>
                      <div className="text-sm text-charcoal-500">{t('sales.activeLeads')}</div>
                  </div>
              </div>
          </div>

          {/* Kanban Board */}
          <div className="flex gap-6 overflow-x-auto pb-6 h-[calc(100vh-280px)]">
              {stages.map(stage => (
                  <div key={stage.id} className="flex-1 min-w-[300px] flex flex-col bg-white rounded-xl border border-charcoal-200 shadow-sm overflow-hidden h-full">
                      <div className={`p-3 border-b border-charcoal-100 font-semibold text-sm flex justify-between items-center ${stage.color}`}>
                          <span>{stage.label}</span>
                          <span className="bg-white/50 px-2 py-0.5 rounded text-xs font-bold text-charcoal-600">
                              {pipelineProjects.filter(p => (p.stage || 'lead') === stage.id).length}
                          </span>
                      </div>
                      <div className="p-3 flex-1 overflow-y-auto custom-scrollbar space-y-3 bg-charcoal-50/30">
                          {pipelineProjects
                              .filter(p => (p.stage || 'lead') === stage.id)
                              .map(project => (
                                  <div key={project.id} className="bg-white p-3 rounded-lg border border-charcoal-200 shadow-sm hover:shadow-md transition-all group">
                                      <div className="flex justify-between items-start mb-2">
                                          <div className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${PASTEL_VARIANTS[project.color].bg} ${PASTEL_VARIANTS[project.color].text}`}>
                                              {project.client}
                                          </div>
                                          <div className="text-xs font-bold text-charcoal-400">
                                              {project.probability}%
                                          </div>
                                      </div>
                                      <h4 className="font-bold text-charcoal-900 mb-1">{project.name}</h4>
                                      <div className="flex justify-between items-center text-xs text-charcoal-500 mb-3">
                                          <span>{(() => {
                                              const budgetNum = parseBudget(project.budget);
                                              return budgetNum != null ? formatEuro(budgetNum) : (project.budget || 'TBD');
                                          })()}</span>
                                          <span>{project.volume || 0}d</span>
                                      </div>
                                      
                                      {/* Controls */}
                                      <div className="pt-2 border-t border-charcoal-50 flex gap-2 overflow-x-auto opacity-0 group-hover:opacity-100 transition-opacity">
                                          {stages.map(s => (
                                              <button 
                                                key={s.id}
                                                onClick={() => handleStageChange(project, s.id)}
                                                className={`flex-shrink-0 w-2 h-2 rounded-full border border-charcoal-300 hover:scale-125 transition-transform ${project.stage === s.id ? 'bg-orange-500 border-orange-600' : 'bg-white'}`}
                                                title={`Move to ${s.label}`}
                                              />
                                          ))}
                                      </div>
                                  </div>
                              ))
                          }
                      </div>
                  </div>
              ))}
          </div>

      </div>

      {/* Add Lead Modal */}
      <Modal isOpen={isAddLeadOpen} onClose={() => setIsAddLeadOpen(false)} title={t('sales.addLead')} size="sm">
          <form onSubmit={handleAddLead} className="space-y-4">
              <div>
                  <label className="block text-xs font-bold text-charcoal-500 uppercase tracking-wider mb-1">{t('projects.projectName')}</label>
                  <input name="name" required className="w-full border border-charcoal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-orange-500/20 outline-none" placeholder="e.g. Website Relaunch" />
              </div>
              <div>
                  <label className="block text-xs font-bold text-charcoal-500 uppercase tracking-wider mb-1">{t('projects.client')}</label>
                  <input name="client" required className="w-full border border-charcoal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-orange-500/20 outline-none" placeholder="Client Name" />
              </div>
              <div>
                  <label className="block text-xs font-bold text-charcoal-500 uppercase tracking-wider mb-1">{t('projects.budget')}</label>
                  <input name="budget" className="w-full border border-charcoal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-orange-500/20 outline-none" placeholder="e.g. 50k" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" onClick={() => setIsAddLeadOpen(false)}>{t('planner.cancel')}</Button>
                  <Button type="submit" className="bg-orange-600 hover:bg-orange-700 text-white">{t('planner.save')}</Button>
              </div>
          </form>
      </Modal>

      {/* AI Market Trends Modal */}
      <Modal isOpen={isAiModalOpen} onClose={() => setIsAiModalOpen(false)} title={t('sales.marketScoutTitle')}>
          <div className="space-y-4">
              {!isAiEnabled ? (
                  <div className="bg-red-50 text-red-600 p-3 rounded border border-red-200 text-sm flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      AI Not Configured. Check Settings.
                  </div>
              ) : (
                  <>
                      <div>
                          <label className="block text-xs font-bold text-charcoal-500 uppercase tracking-wider mb-2">{t('sales.trendsPrompt')}</label>
                          <div className="flex gap-2">
                              <input 
                                  value={trendsPrompt}
                                  onChange={(e) => setTrendsPrompt(e.target.value)}
                                  className="flex-1 border border-charcoal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-purple-500/20 outline-none" 
                                  placeholder="e.g. Fintech trends in Germany 2025" 
                              />
                              <Button onClick={analyzeTrends} disabled={isAnalyzing} className="bg-purple-600 hover:bg-purple-700 text-white">
                                  {isAnalyzing ? <AsciiSpinner /> : <Search className="w-4 h-4" />}
                              </Button>
                          </div>
                      </div>
                      
                      {aiResult && (
                          <div className="bg-charcoal-900 text-gray-300 p-4 rounded-lg font-mono text-sm max-h-[300px] overflow-y-auto border border-charcoal-700 shadow-inner">
                              <div className="markdown-prose whitespace-pre-wrap">{aiResult}</div>
                          </div>
                      )}
                  </>
              )}
          </div>
      </Modal>
    </div>
  );
};