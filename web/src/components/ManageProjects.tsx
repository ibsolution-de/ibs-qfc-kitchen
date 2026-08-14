import React, { useState, useEffect, useCallback } from 'react';
import { Project, Milestone, Account } from '../types';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { PASTEL_VARIANTS } from '../constants';
import { Plus, Trash2, Edit2, Calendar, DollarSign, Folder, BarChart2, AlertCircle, Flag, X } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { parseBudget, formatEuro, MARGIN_THRESHOLDS } from '../utils/money';
import { projectBudget, confirmedBudget, requestedBudget } from '../utils/accounts';
import { uid } from '../utils/uid';
import { PageHeader } from './ui/PageHeader';
import { FormField, TextInput, SelectInput, inputClass } from './ui/FormField';
import { ProgressBar } from './ui/ProgressBar';
import { StatusBadge } from './ui/StatusBadge';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useToast } from './ui/Toast';
import { useCrudForm } from '../hooks/useCrudForm';

const ACCOUNT_FORM_DEFAULTS: { name: string; status: Account['status']; startDate: string; endDate: string; budget: string } = {
  name: '',
  status: 'confirmed',
  startDate: '',
  endDate: '',
  budget: ''
};

interface ManageProjectsProps {
  projects: Project[];
  onUpdateProjects: (projects: Project[]) => void;
  highlightedProjectId?: string | null;
  /**
   * Persist an account immediately (live store `saveAccount`). Optional so the
   * app keeps compiling before the App-level wiring lands (no-op default).
   */
  onSaveAccount?: (account: Account) => void | Promise<void>;
  /**
   * Delete an account immediately (live store `deleteAccount`). Optional so the
   * app keeps compiling before the App-level wiring lands (no-op default).
   */
  onDeleteAccount?: (id: string) => void | Promise<void>;
}

export const ManageProjects: React.FC<ManageProjectsProps> = ({
  projects,
  onUpdateProjects,
  highlightedProjectId,
  onSaveAccount,
  onDeleteAccount
}) => {
  const { t } = useLanguage();
  const { success, error } = useToast();

  // Best-effort immediate persistence through the store RPCs; no-op defaults
  // keep this component compiling before App wiring provides them.
  const persistAccount = onSaveAccount ?? (async () => {});
  const removeAccount = onDeleteAccount ?? (async () => {});

  const makeDefaults = useCallback(
    (): Partial<Project> => ({
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
    }),
    []
  );

  const {
    isModalOpen,
    editingId,
    formData,
    setFormData,
    openAdd,
    openEdit,
    closeModal,
    handleSubmit,
    requestDelete,
    confirmDelete,
    deleteTarget,
    cancelDelete,
    validationError
  } = useCrudForm<Project>({
    items: projects,
    onUpdate: onUpdateProjects,
    makeDefaults,
    validate: useCallback(
      (data) => {
        if (!data.name?.trim() || !data.client?.trim()) {
          return t('projects.validation.required');
        }
        if (data.startDate && data.endDate && data.endDate < data.startDate) {
          return t('projects.validation.dates');
        }
        return null;
      },
      [t]
    ),
    onAfterSave: useCallback(() => success(t('toast.projectSaved')), [success, t]),
    onAfterDelete: useCallback(() => success(t('toast.projectDeleted')), [success, t])
  });

  const [newMilestone, setNewMilestone] = useState<Partial<Milestone>>({ name: '', date: '', phase: 'planning' });

  // Inline account editor state (works on the modal's working copy of the
  // project; rows are persisted immediately through the store RPCs).
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState(ACCOUNT_FORM_DEFAULTS);
  const [accountValidationError, setAccountValidationError] = useState<string | null>(null);
  const [accountSaving, setAccountSaving] = useState(false);

  // Scroll to highlighted project
  useEffect(() => {
    if (highlightedProjectId) {
      const element = document.getElementById(`project-card-${highlightedProjectId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [highlightedProjectId]);

  // Accounts persist immediately through onSaveAccount/onDeleteAccount — the
  // store is the source of truth. Whenever the live project's accounts change
  // (an RPC round-trip assigns real server ids), converge the modal's working
  // copy so optimistic placeholder rows are replaced instead of duplicated.
  useEffect(() => {
    if (!isModalOpen || !editingId) return;
    const live = projects.find(p => p.id === editingId);
    if (!live || !live.accounts) return;
    setFormData(prev => (prev.id === editingId ? { ...prev, accounts: live.accounts } : prev));
  }, [projects, isModalOpen, editingId, setFormData]);

  const buildProject = (data: Partial<Project>, editingId: string | null): Project => {
    const name = data.name?.trim() ?? '';
    const client = data.client?.trim() ?? '';
    return {
      id: editingId ?? uid(),
      name,
      client,
      topic: data.topic?.trim(),
      budget: data.budget?.trim(),
      startDate: data.startDate,
      endDate: data.endDate,
      status: data.status ?? 'active',
      color: data.color ?? 'blue',
      notes: data.notes?.trim(),
      volume: data.volume ?? 0,
      isCritical: data.isCritical ?? false,
      hourlyRate: data.hourlyRate ?? 100,
      milestones: data.milestones ?? [],
      probability: data.probability ?? 50,
      stage: data.stage ?? 'lead',
      // Preserve immediately-persisted accounts (the server strips accounts
      // from project blobs; this only carries local/optimistic copies over).
      accounts: data.accounts ?? []
    };
  };

  const addMilestone = () => {
    if (newMilestone.name && newMilestone.date) {
      const milestone: Milestone = {
        id: uid(),
        name: newMilestone.name,
        date: newMilestone.date,
        phase: newMilestone.phase ?? 'planning'
      };
      setFormData(prev => ({
        ...prev,
        milestones: [...(prev.milestones || []), milestone]
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

  const modalAccounts = formData.accounts ?? [];

  const openNewAccountForm = () => {
    setEditingAccountId(null);
    setAccountForm({ ...ACCOUNT_FORM_DEFAULTS });
    setAccountValidationError(null);
    setShowAccountForm(true);
  };

  const startEditAccount = (a: Account) => {
    setEditingAccountId(a.id);
    setAccountForm({
      name: a.name,
      status: a.status,
      startDate: a.startDate ?? '',
      endDate: a.endDate ?? '',
      budget: a.budget ?? ''
    });
    setAccountValidationError(null);
    setShowAccountForm(true);
  };

  const cancelAccountForm = () => {
    setShowAccountForm(false);
    setEditingAccountId(null);
    setAccountForm({ ...ACCOUNT_FORM_DEFAULTS });
    setAccountValidationError(null);
  };

  const handleDeleteAccount = async (id: string) => {
    // Drop the row locally for immediate feedback; the store stays authoritative.
    setFormData(prev => ({ ...prev, accounts: (prev.accounts ?? []).filter(a => a.id !== id) }));
    try {
      await removeAccount(id);
    } catch {
      error(t('common.saveError'));
    }
  };

  const handleAccountSubmit = async () => {
    if (!editingId) return; // New projects have no id yet — accounts are added once the project exists.
    const name = accountForm.name.trim();
    if (!name) {
      setAccountValidationError(t('projects.validation.required'));
      return;
    }
    const startDate = accountForm.startDate || undefined;
    const endDate = accountForm.endDate || undefined;
    if (startDate && endDate && endDate < startDate) {
      setAccountValidationError(t('projects.validation.dates'));
      return;
    }
    const budget = accountForm.budget.trim() || undefined;
    if (budget && parseBudget(budget) === null) {
      setAccountValidationError(t('projects.validation.required'));
      return;
    }

    const account: Account = {
      // id '' tells the backend to mint a fresh UUID for new accounts; edits
      // reuse the persisted id.
      id: editingAccountId ?? '',
      projectId: editingId,
      name,
      status: accountForm.status,
      startDate,
      endDate,
      budget
    };

    // Accounts are saved the moment the RPC resolves — canceling/closing the
    // project modal does NOT roll back already-saved accounts. On success we
    // fold the row into the modal's working copy; the store's PROJECT update
    // (and the convergence effect above) then swaps in the server-issued id.
    setAccountSaving(true);
    setAccountValidationError(null);
    try {
      await persistAccount(account);
      setFormData(prev => {
        const accounts = prev.accounts ?? [];
        const exists = accounts.some(a => a.id === editingAccountId);
        return {
          ...prev,
          accounts: exists ? accounts.map(a => (a.id === editingAccountId ? account : a)) : [...accounts, account]
        };
      });
      setShowAccountForm(false);
      setEditingAccountId(null);
      setAccountForm({ ...ACCOUNT_FORM_DEFAULTS });
    } catch {
      setAccountValidationError(t('common.saveError'));
    } finally {
      setAccountSaving(false);
    }
  };

  const calculateMargin = (project: Project) => {
    // Effective budget: Σ account budgets, falling back to the project's
    // estimated budget when the project has no accounts.
    const budget = projectBudget(project);
    if (!project.volume || !project.hourlyRate) return { percent: 0, color: 'bg-gray-200' };
    const estimatedCost = (project.volume * 8 * project.hourlyRate);
    const margin = budget - estimatedCost;
    const percent = budget > 0 ? (margin / budget) * 100 : 0;

    let color = 'bg-green-500';
    if (percent < MARGIN_THRESHOLDS.risk) color = 'bg-red-500';
    else if (percent < MARGIN_THRESHOLDS.healthy) color = 'bg-yellow-500';

    return { percent, color, margin };
  };

  return (
    <div className="h-full overflow-auto bg-gray-50/50 p-6 custom-scrollbar">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title={t('projects.title')}
          subtitle={t('projects.subtitle')}
          actions={
            <Button onClick={openAdd} className="gap-2">
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
                  <button onClick={() => openEdit(p)} className="p-1.5 text-charcoal-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={() => requestDelete(p.id)} className="p-1.5 text-charcoal-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
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

                  {/* Account (Beauftragung) summary */}
                  {(p.accounts ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-charcoal-500">
                      <span className="font-semibold text-charcoal-700">{t('projects.accounts')}: {(p.accounts ?? []).length}</span>
                      <span className="text-green-700 font-medium">{t('projects.statusConfirmed')}: {formatEuro(confirmedBudget(p))}</span>
                      <span className="text-orange-700 font-medium">{t('projects.statusRequested')}: {formatEuro(requestedBudget(p))}</span>
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
                      <div className="flex items-center gap-1.5" title={t('projects.estimatedBudget')}>
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
            );
          })}
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={closeModal} title={editingId ? t('projects.editProject') : t('projects.newProject')} size="lg">
        <form onSubmit={handleSubmit(buildProject)} className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <FormField label={t('projects.projectName')} htmlFor="projectName">
                <TextInput id="projectName" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
              </FormField>
              <FormField label={t('projects.client')} htmlFor="projectClient">
                <TextInput id="projectClient" required value={formData.client} onChange={e => setFormData({ ...formData, client: e.target.value })} />
              </FormField>
              <FormField label={t('projects.topic')} htmlFor="projectTopic">
                <TextInput id="projectTopic" value={formData.topic} onChange={e => setFormData({ ...formData, topic: e.target.value })} placeholder={t('projects.placeholderTopic')} />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label={t('projects.estimatedBudget')} htmlFor="projectBudget">
                  <TextInput id="projectBudget" value={formData.budget} onChange={e => setFormData({ ...formData, budget: e.target.value })} placeholder={t('projects.placeholderBudget')} />
                </FormField>
                <FormField label={t('projects.hourlyRate')} htmlFor="projectHourlyRate">
                  <TextInput id="projectHourlyRate" type="number" value={formData.hourlyRate} onChange={e => {
                    const n = e.target.valueAsNumber;
                    if (Number.isNaN(n)) return;
                    setFormData({ ...formData, hourlyRate: n });
                  }} placeholder="100" />
                </FormField>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField label={t('projects.status')} htmlFor="projectStatus">
                  <SelectInput id="projectStatus" value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value as Project['status'] })}>
                    <option value="active">{t('status.active')}</option>
                    <option value="opportunity">{t('status.opportunity')}</option>
                    <option value="completed">{t('status.completed')}</option>
                    <option value="on_hold">{t('status.on_hold')}</option>
                  </SelectInput>
                </FormField>
                <FormField label={t('projects.salesStage')} htmlFor="projectSalesStage">
                  <SelectInput id="projectSalesStage" value={formData.stage || 'lead'} onChange={e => setFormData({ ...formData, stage: e.target.value as Project['stage'] })}>
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
                    setFormData({ ...formData, volume: n });
                  }} placeholder="80" />
                </FormField>
                <FormField label={`${t('projects.probability')} %`} htmlFor="projectProbability">
                  <TextInput id="projectProbability" type="number" min="0" max="100" value={formData.probability ?? 0} onChange={e => {
                    const n = e.target.valueAsNumber;
                    if (Number.isNaN(n)) return;
                    setFormData({ ...formData, probability: Math.max(0, Math.min(100, n)) });
                  }} placeholder="50" />
                </FormField>
              </div>

              <FormField label={t('projects.dates')} htmlFor="projectStartDate">
                <div className="grid grid-cols-2 gap-2">
                  <TextInput id="projectStartDate" type="date" value={formData.startDate} onChange={e => setFormData({ ...formData, startDate: e.target.value })} />
                  <TextInput type="date" value={formData.endDate} onChange={e => setFormData({ ...formData, endDate: e.target.value })} />
                </div>
              </FormField>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">{t('projects.milestones')}</label>
            <div className="border border-charcoal-200 rounded-lg p-3 bg-charcoal-50/50">
              <div className="flex gap-2 mb-2">
                <TextInput type="date" className="w-32" value={newMilestone.date} onChange={e => setNewMilestone({ ...newMilestone, date: e.target.value })} />
                <TextInput className="flex-1" placeholder={t('projects.milestoneName')} value={newMilestone.name} onChange={e => setNewMilestone({ ...newMilestone, name: e.target.value })} />
                <SelectInput className="w-auto" value={newMilestone.phase} onChange={e => setNewMilestone({ ...newMilestone, phase: e.target.value as Milestone['phase'] })}>
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

          {/* Accounts (Beauftragungen)
              Accounts are persisted immediately through onSaveAccount/
              onDeleteAccount (store RPCs), NOT through the project <form>.
              Canceling/closing the project modal does NOT roll back accounts
              that were already saved. New projects can only add accounts once
              the project exists — the backend requires a real project id. */}
          <div>
            <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">{t('projects.accounts')}</label>
            <div className="border border-charcoal-200 rounded-lg p-3 bg-charcoal-50/50 space-y-2">
              {!editingId ? (
                <p className="text-sm text-charcoal-400 italic">{t('projects.noAccounts')}</p>
              ) : (
                <>
                  {modalAccounts.length === 0 ? (
                    <p className="text-sm text-charcoal-400 italic">{t('projects.noAccounts')}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {modalAccounts.map(a => (
                        <div key={a.id} className="flex items-center justify-between gap-2 bg-white p-2 rounded border border-charcoal-100">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className="font-medium text-sm text-charcoal-800">{a.name}</span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${a.status === 'confirmed' ? 'bg-green-100 text-green-800 border-green-200' : 'bg-orange-100 text-orange-800 border-orange-200'}`}>
                              {a.status === 'confirmed' ? t('projects.statusConfirmed') : t('projects.statusRequested')}
                            </span>
                            <span className="text-xs text-charcoal-400 font-mono">{a.startDate ? `${a.startDate} – ${a.endDate || 'TBD'}` : 'TBD'}</span>
                            <span className="text-xs font-semibold font-mono text-charcoal-700">
                              {a.budget && parseBudget(a.budget) !== null ? formatEuro(parseBudget(a.budget) as number) : (a.budget || '—')}
                            </span>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <button type="button" onClick={() => startEditAccount(a)} className="p-1 text-charcoal-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" onClick={() => { void handleDeleteAccount(a.id); }} className="p-1 text-charcoal-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {showAccountForm ? (
                    <div
                      className="border-t border-charcoal-100 pt-2 space-y-2"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          // Route Enter to the account save instead of submitting
                          // the surrounding project form.
                          e.preventDefault();
                          e.stopPropagation();
                          void handleAccountSubmit();
                        }
                      }}
                    >
                      <div className="grid grid-cols-2 gap-2">
                        <FormField label={t('projects.accountName')} htmlFor="accountName">
                          <TextInput id="accountName" required value={accountForm.name} onChange={e => setAccountForm({ ...accountForm, name: e.target.value })} />
                        </FormField>
                        <FormField label={t('projects.accountStatus')} htmlFor="accountStatus">
                          <SelectInput id="accountStatus" value={accountForm.status} onChange={e => setAccountForm({ ...accountForm, status: e.target.value as Account['status'] })}>
                            <option value="confirmed">{t('projects.statusConfirmed')}</option>
                            <option value="requested">{t('projects.statusRequested')}</option>
                          </SelectInput>
                        </FormField>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <FormField label={t('projects.accountStart')} htmlFor="accountStart">
                          <TextInput id="accountStart" type="date" value={accountForm.startDate} onChange={e => setAccountForm({ ...accountForm, startDate: e.target.value })} />
                        </FormField>
                        <FormField label={t('projects.accountEnd')} htmlFor="accountEnd">
                          <TextInput id="accountEnd" type="date" value={accountForm.endDate} onChange={e => setAccountForm({ ...accountForm, endDate: e.target.value })} />
                        </FormField>
                      </div>
                      <FormField label={t('projects.accountBudget')} htmlFor="accountBudget">
                        <TextInput id="accountBudget" value={accountForm.budget} onChange={e => setAccountForm({ ...accountForm, budget: e.target.value })} placeholder="e.g. 50k" />
                      </FormField>
                      {accountValidationError && (
                        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded p-2">{accountValidationError}</p>
                      )}
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="ghost" onClick={cancelAccountForm}>{t('projects.cancel')}</Button>
                        <Button type="button" onClick={() => { void handleAccountSubmit(); }} disabled={accountSaving}>
                          {t('projects.addAccount')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={openNewAccountForm} className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded px-2 py-1 transition-colors">
                      <Plus className="w-4 h-4" /> {t('projects.addAccount')}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <input
                type="checkbox"
                id="isCritical"
                checked={formData.isCritical}
                onChange={(e) => setFormData({ ...formData, isCritical: e.target.checked })}
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
                  onClick={() => setFormData({ ...formData, color })}
                  className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-transform ${(PASTEL_VARIANTS[color] ?? PASTEL_VARIANTS.gray).bg} ${(PASTEL_VARIANTS[color] ?? PASTEL_VARIANTS.gray).border} ${formData.color === color ? 'ring-2 ring-offset-2 ring-charcoal-400 scale-110' : 'hover:scale-105'}`}
                >
                  <Folder className={`w-4 h-4 ${(PASTEL_VARIANTS[color] ?? PASTEL_VARIANTS.gray).text}`} />
                </button>
              ))}
            </div>
          </div>

          <FormField label={t('projects.notes')} htmlFor="projectNotes">
            <textarea id="projectNotes" rows={3} className={`${inputClass} resize-none`} value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} />
          </FormField>

          {validationError && (
            <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">{validationError}</div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-charcoal-100">
            <Button type="button" variant="ghost" onClick={closeModal}>{t('projects.cancel')}</Button>
            <Button type="submit">{t('projects.saveProject')}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={t('projects.deleteTitle')}
        message={t('projects.confirmDelete')}
        confirmLabel={t('projects.delete')}
        cancelLabel={t('projects.cancel')}
        destructive
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
};
