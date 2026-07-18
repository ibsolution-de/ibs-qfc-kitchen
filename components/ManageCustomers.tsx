
import React, { useState } from 'react';
import { Customer, Project, Assignment } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { Briefcase, Mail, Building2, UserCircle, PieChart, AlertTriangle, CheckCircle, Folder, Trash2, Edit2 } from 'lucide-react';
import { PASTEL_VARIANTS } from '../constants';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { parseBudget } from '../utils/money';
import { uid } from '../utils/uid';

interface ManageCustomersProps {
  customers: Customer[];
  projects: Project[];
  assignments: Assignment[];
  onNavigateToProject: (projectId: string) => void;
  onUpdateCustomers: (customers: Customer[]) => void;
}

export const ManageCustomers: React.FC<ManageCustomersProps> = ({ customers, projects, assignments, onNavigateToProject, onUpdateCustomers }) => {
  const { t } = useLanguage();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Customer>>({
    name: '',
    logo: '',
    industry: '',
    contactName: '',
    email: '',
    notes: '',
  });

  const getCustomerStats = (customer: Customer) => {
    // 1. Find all projects for this customer (matching by client name)
    const custProjects = projects.filter(p => p.client === customer.name && p.status !== 'completed');
    
    // 2. Aggregate Data
    let totalBudget = 0;
    let totalPlannedValue = 0;
    let totalVolume = 0;
    let totalPlannedDays = 0;

    const projectBreakdown = custProjects.map(p => {
        // Calculate Planned Days (from assignments)
        // Note: In a real app, we'd filter assignments by date range too. 
        // Here we sum all assignments in the active version for this project.
        const plannedDays = assignments.filter(a => a.projectId === p.id).length;
        const volume = p.volume || 1; // Avoid divide by zero
        
        // Calculate Budget
        const budget = parseBudget(p.budget) ?? 0;
        
        // Estimate value consumed based on % complete of volume
        // Formula: (Planned Days / Volume) * Budget
        // Cap at Budget if planned days > volume
        const percentComplete = Math.min(plannedDays / volume, 1.5); // Allow overburn up to 150%
        const plannedValue = budget * percentComplete;

        totalBudget += budget;
        totalPlannedValue += plannedValue;
        totalVolume += volume;
        totalPlannedDays += plannedDays;

        return {
            ...p,
            plannedDays,
            percentComplete: (plannedDays / volume) * 100,
            coverageStatus: plannedDays >= volume ? 'full' : (plannedDays / volume > 0.8 ? 'good' : 'low')
        };
    });

    const budgetCoverage = totalBudget > 0 ? (totalPlannedValue / totalBudget) * 100 : 0;
    const hrCoverage = totalVolume > 0 ? (totalPlannedDays / totalVolume) * 100 : 0;

    return {
        projectBreakdown,
        totalBudget,
        budgetCoverage,
        hrCoverage,
        totalPlannedDays,
        totalVolume
    };
  };

  const handleAdd = () => {
    setEditingId(null);
    setFormData({ name: '', logo: '', industry: '', contactName: '', email: '', notes: '' });
    setIsModalOpen(true);
  };

  const handleEdit = (customer: Customer) => {
    setEditingId(customer.id);
    setFormData({ ...customer });
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm(t('customers.confirmDelete'))) {
      onUpdateCustomers(customers.filter(c => c.id !== id));
    }
  };

  const generateLogo = (name: string) => {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0D8ABC&color=fff`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email) return;

    const logo = formData.logo?.trim() || generateLogo(formData.name);
    const payload: Customer = {
      id: editingId || uid(),
      name: formData.name.trim(),
      logo,
      industry: (formData.industry || '').trim(),
      contactName: (formData.contactName || '').trim(),
      email: formData.email.trim(),
      notes: (formData.notes || '').trim(),
    };

    if (editingId) {
      onUpdateCustomers(customers.map(c => c.id === editingId ? payload : c));
    } else {
      onUpdateCustomers([...customers, payload]);
    }
    setIsModalOpen(false);
  };

  return (
    <div className="h-full overflow-auto bg-gray-50/50 p-6 custom-scrollbar">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-end mb-8">
            <div>
                <h1 className="text-2xl font-semibold text-charcoal-900 tracking-tight">{t('customers.title')}</h1>
                <p className="text-charcoal-500 mt-1">{t('customers.subtitle')}</p>
            </div>
            <Button className="gap-2" onClick={handleAdd}>
                <Building2 className="w-4 h-4" /> {t('customers.addCustomer')}
            </Button>
        </div>

        <div className="grid grid-cols-1 gap-8">
            {customers.map(customer => {
                const stats = getCustomerStats(customer);
                
                return (
                    <div key={customer.id} className="bg-white rounded-xl border border-charcoal-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow relative group">
                        {/* Header Section */}
                        <div className="p-6 border-b border-charcoal-100 flex flex-col md:flex-row gap-6">
                            <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                <button
                                    onClick={() => handleEdit(customer)}
                                    className="p-1.5 text-charcoal-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                    title={t('customers.editCustomer')}
                                >
                                    <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => handleDelete(customer.id)}
                                    className="p-1.5 text-charcoal-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                    title={t('customers.deleteCustomer')}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Customer Info */}
                            <div className="flex items-start gap-4 flex-1">
                                <img src={customer.logo} alt={customer.name} className="w-16 h-16 rounded-lg border border-charcoal-100 object-cover" />
                                <div>
                                    <h3 className="text-xl font-bold text-charcoal-900">{customer.name}</h3>
                                    <div className="flex items-center gap-2 text-sm text-charcoal-500 mt-1">
                                        <Building2 className="w-3.5 h-3.5" />
                                        <span>{customer.industry}</span>
                                    </div>
                                    <div className="flex items-center gap-4 mt-3 text-sm">
                                        <div className="flex items-center gap-1.5 text-charcoal-600">
                                            <UserCircle className="w-4 h-4 text-charcoal-400" />
                                            {customer.contactName}
                                        </div>
                                        <div className="flex items-center gap-1.5 text-charcoal-600">
                                            <Mail className="w-4 h-4 text-charcoal-400" />
                                            {customer.email}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Key Stats Cards */}
                            <div className="flex gap-4 md:min-w-[400px]">
                                {/* HR Coverage Card */}
                                <div className="flex-1 bg-blue-50/50 rounded-lg p-4 border border-blue-100">
                                    <div className="flex items-center gap-2 mb-2">
                                        <PieChart className="w-4 h-4 text-blue-600" />
                                        <span className="text-xs font-semibold text-blue-800 uppercase tracking-wider">{t('customers.hrCoverage')}</span>
                                    </div>
                                    <div className="flex items-end gap-2">
                                        <span className="text-2xl font-bold text-charcoal-900">{Math.round(stats.hrCoverage)}%</span>
                                        <span className="text-xs text-charcoal-500 mb-1">
                                            {stats.totalPlannedDays}/{stats.totalVolume} {t('customers.days')}
                                        </span>
                                    </div>
                                    <div className="w-full bg-blue-100 h-1.5 rounded-full mt-3 overflow-hidden">
                                        <div 
                                            className="bg-blue-600 h-full rounded-full transition-all duration-500" 
                                            style={{ width: `${Math.min(stats.hrCoverage, 100)}%` }} 
                                        />
                                    </div>
                                </div>

                                {/* Budget Coverage Card */}
                                <div className="flex-1 bg-green-50/50 rounded-lg p-4 border border-green-100">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Briefcase className="w-4 h-4 text-green-600" />
                                        <span className="text-xs font-semibold text-green-800 uppercase tracking-wider">{t('customers.budgetCoverage')}</span>
                                    </div>
                                    <div className="flex items-end gap-2">
                                        <span className="text-2xl font-bold text-charcoal-900">{Math.round(stats.budgetCoverage)}%</span>
                                    </div>
                                    <div className="w-full bg-green-100 h-1.5 rounded-full mt-3 overflow-hidden">
                                        <div 
                                            className="bg-green-600 h-full rounded-full transition-all duration-500" 
                                            style={{ width: `${Math.min(stats.budgetCoverage, 100)}%` }} 
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Projects Breakdown */}
                        <div className="p-6 bg-charcoal-50/30">
                            <h4 className="text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-4">{t('customers.projects')}</h4>
                            <div className="space-y-4">
                                {stats.projectBreakdown.length > 0 ? stats.projectBreakdown.map(proj => (
                                    <div key={proj.id} className="bg-white border border-charcoal-200 rounded-lg p-4 flex flex-col sm:flex-row items-center gap-4 hover:border-blue-200 transition-colors">
                                        {/* Project Info */}
                                        <div className="flex items-center gap-3 flex-1 w-full">
                                            <Folder className={`w-4 h-4 flex-shrink-0 ${PASTEL_VARIANTS[proj.color].text}`} />
                                            <div>
                                                <button 
                                                    onClick={() => onNavigateToProject(proj.id)}
                                                    className="text-sm font-bold text-charcoal-900 hover:text-blue-600 hover:underline text-left transition-colors"
                                                >
                                                    {proj.name}
                                                </button>
                                                <div className="text-xs text-charcoal-500">{proj.topic || '-'}</div>
                                            </div>
                                            {proj.status === 'opportunity' && (
                                                <span className="text-[10px] bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded border border-orange-100 font-medium">OPP</span>
                                            )}
                                        </div>

                                        {/* Progress Bar Section */}
                                        <div className="flex-1 w-full max-w-md">
                                            <div className="flex justify-between text-xs mb-1.5">
                                                <span className="text-charcoal-600">
                                                    {t('customers.planned')}: <span className="font-semibold">{proj.plannedDays}</span> / {proj.volume}d
                                                </span>
                                                {proj.volume && proj.plannedDays < proj.volume ? (
                                                    <span className="text-red-500 font-medium flex items-center gap-1">
                                                        <AlertTriangle className="w-3 h-3" />
                                                        -{proj.volume - proj.plannedDays} {t('customers.gap')}
                                                    </span>
                                                ) : (
                                                    <span className="text-green-600 font-medium flex items-center gap-1">
                                                        <CheckCircle className="w-3 h-3" />
                                                        {t('customers.onTrack')}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="w-full bg-charcoal-100 h-2 rounded-full overflow-hidden">
                                                <div 
                                                    className={`h-full rounded-full transition-all duration-500 ${
                                                        proj.coverageStatus === 'full' ? 'bg-green-500' :
                                                        proj.coverageStatus === 'good' ? 'bg-blue-500' : 'bg-red-400'
                                                    }`}
                                                    style={{ width: `${Math.min(proj.percentComplete, 100)}%` }} 
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )) : (
                                    <div className="text-center py-4 text-charcoal-400 italic text-sm">
                                        {t('customers.noProjects')}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingId ? t('customers.editCustomer') : t('customers.newCustomer')}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">
                  {t('customers.customerName')}
                </label>
                <input
                  required
                  className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">
                  {t('customers.logo')}
                </label>
                <input
                  className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                  value={formData.logo}
                  onChange={e => setFormData({ ...formData, logo: e.target.value })}
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">
                  {t('customers.industry')}
                </label>
                <input
                  className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                  value={formData.industry}
                  onChange={e => setFormData({ ...formData, industry: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">
                  {t('customers.contactName')}
                </label>
                <input
                  className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                  value={formData.contactName}
                  onChange={e => setFormData({ ...formData, contactName: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">
                  {t('customers.email')}
                </label>
                <input
                  type="email"
                  required
                  className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">
              {t('customers.notes')}
            </label>
            <textarea
              rows={3}
              className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none resize-none"
              value={formData.notes}
              onChange={e => setFormData({ ...formData, notes: e.target.value })}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-charcoal-100">
            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>
              {t('customers.cancel')}
            </Button>
            <Button type="submit">{t('customers.saveCustomer')}</Button>
          </div>
        </form>
      </Modal>
      </div>
    </div>
  );
};
