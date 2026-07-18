

import React, { useState, useEffect } from 'react';
import { Project, Milestone } from '../types';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { PASTEL_VARIANTS } from '../constants';
import { Plus, Trash2, Edit2, Calendar, DollarSign, Folder, BarChart2, AlertCircle, Flag, X } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { parseBudget, MARGIN_THRESHOLDS } from '../utils/money';
import { uid } from '../utils/uid';
import { PageHeader } from './ui/PageHeader';
import { FormField, TextInput, SelectInput, inputClass } from './ui/FormField';
import { ProgressBar } from './ui/ProgressBar';
import { StatusBadge } from './ui/StatusBadge';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useToast } from './ui/Toast';

interface ManageProjectsProps {
  projects: Project[];
  onUpdateProjects: (projects: Project[]) => void;
  highlightedProjectId?: string | null;
}

export const ManageProjects: React.FC<ManageProjectsProps> = ({ projects, onUpdateProjects, highlightedProjectId }) => {
  const { t } = useLanguage();
  const { success } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState<Partial<Project>>({
    name: '',
    client: '',
    topic: '',
    budget: '',
    startDate: '',
    endDate: '',
    status: 'active',
    color: 'blue',
    notes: '',
    volume: 0,
    isCritical: false,
    hourlyRate: 100,
    milestones: [],
    probability: 50,
    stage: 'qualified'
  });

  const [newMilestone, setNewMilestone] = useState<Partial<Milestone>>({ name: '', date: '', phase: 'planning' });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Scroll to highlighted project
  useEffect(() => {
    if (highlightedProjectId) {
      const element = document.getElementById(`project-card-${highlightedProjectId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [highlightedProjectId]);

  const handleEdit = (proj: Project) => {
    setEditingId(proj.id);
    setFormData({ ...proj, milestones: proj.milestones || [] });
    setIsModalOpen(true);
  };

  const handleAdd = () => {
    setEditingId(null);
    setFormData({
      name: '',
      client: '',
      topic: '',
      budget: '',
      startDate: '',
      endDate: '',
      status: 'active',
      color: 'blue',
      notes: '',
      volume: 40,
      isCritical: false,
      hourlyRate: 100,
      milestones: [],
      probability: 50,
      stage: 'lead'
    });
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    setDeleteId(id);
  };

  const handleConfirmDelete = () => {
    if (!deleteId) return;
    onUpdateProjects(projects.filter(p => p.id !== deleteId));
    success(t('toast.projectDeleted'));
    setDeleteId(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.client) return;

    if (editingId) {
      const updated = projects.map(p => p.id === editingId ? { ...p, ...formData } as Project : p);
      onUpdateProjects(updated);
    } else {
      const newProj: Project = {
        ...formData as Project,
        id: uid()
      };
      onUpdateProjects([...projects, newProj]);
    }
    success(t('toast.projectSaved'));
    setIsModalOpen(false);
  };

  const addMilestone = () => {
      if(newMilestone.name && newMilestone.date) {
          setFormData(prev => ({
              ...prev,
              milestones: [...(prev.milestones || []), { ...newMilestone, id: uid() } as Milestone]
          }));
          setNewMilestone({ name: '', date: '', phase: 'planning' });
      }
  };

  const removeMilestone = (id: string) => {
      setFormData(prev => ({
          ...prev,
          milestones: prev.milestones?.filter(m => m.id !== id) || []
      }));
  };

  const calculateMargin = (project: Project) => {
      const budget = parseBudget(project.budget) ?? 0;
      if(!project.volume || !project.hourlyRate) return { percent: 0, color: 'bg-gray-200' };
      const estimatedCost = (project.volume * 8 * project.hourlyRate);
      const margin = budget - estimatedCost;
      const percent = budget > 0 ? (margin / budget) * 100 : 0;
      
      let color = 'bg-green-500';
      if(percent < MARGIN_THRESHOLDS.risk) color = 'bg-red-500';
      else if(percent < MARGIN_THRESHOLDS.healthy) color = 'bg-yellow-500';
      
      return { percent, color, margin };
  };

  return (
    <div className="h-full overflow-auto bg-gray-50/50 p-6 custom-scrollbar">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title={t('projects.title')}
          subtitle={t('projects.subtitle')}
          actions={
            <Button onClick={handleAdd} className="gap-2">
              <Plus className="w-4 h-4" /> {t('projects.addProject')}
            </Button>
          }
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map(p => {
            const margin = calculateMargin(p);
            return (
            <div 
                key={p.id} 
                id={`project-card-${p.id}`}
                className={`
                    bg-white rounded-xl border shadow-sm p-5 hover:shadow-md transition-all group relative flex flex-col h-full
                    ${highlightedProjectId === p.id ? 'border-blue-400 ring-2 ring-blue-100 shadow-lg scale-[1.02]' : 'border-charcoal-200'}
                    ${p.isCritical ? 'border-l-4 border-l-red-500' : ''}
                `}
            >
              <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <button onClick={() => handleEdit(p)} className="p-1.5 text-charcoal-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Edit2 className="w-4 h-4" /></button>
                <button onClick={() => handleDelete(p.id)} className="p-1.5 text-charcoal-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
              </div>

              <div className="flex items-start gap-3 pr-12 mb-2">
                 <Folder className={`w-4 h-4 mt-1 flex-shrink-0 ${(PASTEL_VARIANTS[p.color] ?? PASTEL_VARIANTS.gray).text}`} />
                 <div>
                   <div className="flex items-center gap-2">
                       <h3 className="font-semibold text-charcoal-900 leading-tight">{p.name}</h3>
                       {p.isCritical && (
                           <div title={t('projects.isCritical')}>
                               <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                           </div>
                       )}
                   </div>
                   <div className="mt-1.5">
                      <StatusBadge status={p.status}>{t(`status.${p.status}`)}</StatusBadge>
                   </div>
                 </div>
              </div>

              <div className="pl-7 mb-4 flex-1">
                 <div className="flex flex-col">
                    <span className="text-sm font-bold text-charcoal-900">{p.client}</span>
                    {p.topic && (
                        <span className="text-xs text-charcoal-500 mt-0.5">{p.topic}</span>
                    )}
                 </div>
                 
                 {/* Margin Health Indicator */}
                 {p.budget && (
                     <div className="mt-3">
                         <ProgressBar
                           value={Math.max(0, Math.min(1, margin.percent / 100))}
                           status={margin.percent < MARGIN_THRESHOLDS.risk ? 'critical' : margin.percent < MARGIN_THRESHOLDS.healthy ? 'warning' : 'good'}
                           size="sm"
                           label={`${t('projects.marginHealth')} (${Math.round(margin.percent)}%)`}
                         />
                     </div>
                 )}

                 {/* Milestone Count */}
                 {p.milestones && p.milestones.length > 0 && (
                     <div className="mt-2 flex items-center gap-1 text-[10px] text-charcoal-500">
                         <Flag className="w-3 h-3" />
                         <span>{p.milestones.length} {t('projects.milestones')}</span>
                     </div>
                 )}
              </div>

              <div className="mt-auto pt-3 border-t border-charcoal-50 flex flex-col items-end gap-1.5 text-xs text-charcoal-500">
                  <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5" title={t('projects.volume')}>
                         <BarChart2 className="w-3.5 h-3.5 text-charcoal-400" />
                         <span className="font-medium text-charcoal-700">{p.volume ? `${p.volume}d` : '-'}</span>
                      </div>
                      {p.budget && (
                         <div className="flex items-center gap-1.5" title={t('projects.budget')}>
                            <DollarSign className="w-3.5 h-3.5 text-charcoal-400" />
                            <span className="font-medium text-charcoal-700">{p.budget}</span>
                         </div>
                      )}
                  </div>
                  <div className="flex items-center gap-1.5">
                     <Calendar className="w-3.5 h-3.5 text-charcoal-400" />
                     <span>{p.startDate ? `${p.startDate} - ${p.endDate || 'TBD'}` : 'TBD'}</span>
                  </div>
              </div>
            </div>
          )})}
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? t('projects.editProject') : t('projects.newProject')} size="lg">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
             <div className="space-y-4">
                <FormField label={t('projects.projectName')} htmlFor="projectName">
                   <TextInput id="projectName" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                </FormField>
                <FormField label={t('projects.client')} htmlFor="projectClient">
                   <TextInput id="projectClient" required value={formData.client} onChange={e => setFormData({...formData, client: e.target.value})} />
                </FormField>
                <FormField label={t('projects.topic')} htmlFor="projectTopic">
                   <TextInput id="projectTopic" value={formData.topic} onChange={e => setFormData({...formData, topic: e.target.value})} placeholder={t('projects.placeholderTopic')} />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                    <FormField label={t('projects.budget')} htmlFor="projectBudget">
                        <TextInput id="projectBudget" value={formData.budget} onChange={e => setFormData({...formData, budget: e.target.value})} placeholder={t('projects.placeholderBudget')} />
                    </FormField>
                    <FormField label={t('projects.hourlyRate')} htmlFor="projectHourlyRate">
                        <TextInput id="projectHourlyRate" type="number" value={formData.hourlyRate} onChange={e => {
                          const n = e.target.valueAsNumber;
                          if (Number.isNaN(n)) return;
                          setFormData({...formData, hourlyRate: n});
                        }} placeholder="100" />
                    </FormField>
                </div>
             </div>

             <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                    <FormField label={t('projects.status')} htmlFor="projectStatus">
                        <SelectInput id="projectStatus" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value as Project['status']})}>
                            <option value="active">{t('status.active')}</option>
                            <option value="opportunity">{t('status.opportunity')}</option>
                            <option value="completed">{t('status.completed')}</option>
                            <option value="on_hold">{t('status.on_hold')}</option>
                        </SelectInput>
                    </FormField>
                     <FormField label={t('projects.salesStage')} htmlFor="projectSalesStage">
                        <SelectInput id="projectSalesStage" value={formData.stage || 'lead'} onChange={e => setFormData({...formData, stage: e.target.value as Project['stage']})}>
                            <option value="lead">{t('sales.stages.lead')}</option>
                            <option value="qualified">{t('sales.stages.qualified')}</option>
                            <option value="proposal">{t('sales.stages.proposal')}</option>
                            <option value="negotiation">{t('sales.stages.negotiation')}</option>
                            <option value="closed">Closed</option>
                        </SelectInput>
                    </FormField>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <FormField label={t('projects.volume')} htmlFor="projectVolume">
                        <TextInput id="projectVolume" type="number" value={formData.volume} onChange={e => {
                          const n = e.target.valueAsNumber;
                          if (Number.isNaN(n) || n < 0) return;
                          setFormData({...formData, volume: n});
                        }} placeholder="80" />
                    </FormField>
                    <FormField label={`${t('projects.probability')} %`} htmlFor="projectProbability">
                        <TextInput id="projectProbability" type="number" min="0" max="100" value={formData.probability ?? 0} onChange={e => {
                          const n = e.target.valueAsNumber;
                          if (Number.isNaN(n)) return;
                          setFormData({...formData, probability: Math.max(0, Math.min(100, n))});
                        }} placeholder="50" />
                    </FormField>
                </div>

                 <FormField label={t('projects.dates')} htmlFor="projectStartDate">
                   <div className="grid grid-cols-2 gap-2">
                     <TextInput id="projectStartDate" type="date" value={formData.startDate} onChange={e => setFormData({...formData, startDate: e.target.value})} />
                     <TextInput type="date" value={formData.endDate} onChange={e => setFormData({...formData, endDate: e.target.value})} />
                   </div>
                </FormField>
             </div>
          </div>

          <div>
             <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">{t('projects.milestones')}</label>
             <div className="border border-charcoal-200 rounded-lg p-3 bg-charcoal-50/50">
                 <div className="flex gap-2 mb-2">
                     <TextInput type="date" className="w-32" value={newMilestone.date} onChange={e => setNewMilestone({...newMilestone, date: e.target.value})} />
                     <TextInput className="flex-1" placeholder={t('projects.milestoneName')} value={newMilestone.name} onChange={e => setNewMilestone({...newMilestone, name: e.target.value})} />
                     <SelectInput className="w-auto" value={newMilestone.phase} onChange={e => setNewMilestone({...newMilestone, phase: e.target.value as Milestone['phase']})}>
                        <option value="planning">Planning</option>
                        <option value="development">Dev</option>
                        <option value="testing">Test</option>
                        <option value="deployment">Deploy</option>
                     </SelectInput>
                     <button type="button" onClick={addMilestone} className="p-1.5 bg-charcoal-800 text-white rounded hover:bg-charcoal-700"><Plus className="w-4 h-4" /></button>
                 </div>
                 <div className="space-y-1">
                     {formData.milestones?.map(m => (
                         <div key={m.id} className="flex items-center justify-between text-sm bg-white p-2 rounded border border-charcoal-100">
                             <div className="flex items-center gap-2">
                                 <Flag className="w-3 h-3 text-charcoal-400" />
                                 <span className="font-mono text-xs">{m.date}</span>
                                 <span className="font-medium">{m.name}</span>
                                 <span className="text-xs text-charcoal-400 px-1 border rounded capitalize">{m.phase}</span>
                             </div>
                             <button type="button" onClick={() => removeMilestone(m.id)} className="text-charcoal-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                         </div>
                     ))}
                 </div>
             </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
                <input 
                    type="checkbox" 
                    id="isCritical"
                    checked={formData.isCritical}
                    onChange={(e) => setFormData({...formData, isCritical: e.target.checked})}
                    className="w-4 h-4 rounded border-charcoal-300 text-red-600 focus:ring-red-500 cursor-pointer"
                />
                <label htmlFor="isCritical" className="text-sm font-medium text-charcoal-700 cursor-pointer flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                    {t('projects.isCritical')}
                </label>
            </div>
            
            <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-2">{t('projects.colorTag')}</label>
            <div className="flex gap-3">
              {(Object.keys(PASTEL_VARIANTS) as Array<keyof typeof PASTEL_VARIANTS>).map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setFormData({...formData, color})}
                  className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-transform ${(PASTEL_VARIANTS[color] ?? PASTEL_VARIANTS.gray).bg} ${(PASTEL_VARIANTS[color] ?? PASTEL_VARIANTS.gray).border} ${formData.color === color ? 'ring-2 ring-offset-2 ring-charcoal-400 scale-110' : 'hover:scale-105'}`}
                >
                   {/* Preview Icon Style */}
                   <Folder className={`w-4 h-4 ${(PASTEL_VARIANTS[color] ?? PASTEL_VARIANTS.gray).text}`} />
                </button>
              ))}
            </div>
          </div>

          <FormField label={t('projects.notes')} htmlFor="projectNotes">
             <textarea id="projectNotes" rows={3} className={`${inputClass} resize-none`} value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} />
          </FormField>

          <div className="flex justify-end gap-3 pt-2 border-t border-charcoal-100">
            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>{t('projects.cancel')}</Button>
            <Button type="submit">{t('projects.saveProject')}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteId !== null}
        title={t('projects.deleteTitle')}
        message={t('projects.confirmDelete')}
        confirmLabel={t('projects.delete')}
        cancelLabel={t('projects.cancel')}
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
};