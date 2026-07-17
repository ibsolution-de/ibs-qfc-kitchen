


import React, { useState, useMemo } from 'react';
import { Employee, Project, Assignment, IkigaiItem } from '../types';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Plus, Trash2, Edit2, Mail, Phone, Upload, User, Star, MapPin, Briefcase, UserPlus, Users, Search, Sparkles, Building2, X, MessageSquare, Target, TrendingUp } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { MOCK_COMPANY_DIRECTORY } from '../constants';
import { OneOnOneDashboard } from './OneOnOneDashboard';
import { CompetencyRadar } from './development/CompetencyRadar';
import { IkigaiBuilder } from './development/IkigaiBuilder';
import { TeamSkillMatrix } from './development/TeamSkillMatrix';

interface ManageTeamProps {
  employees: Employee[];
  projects?: Project[];
  assignments?: Assignment[];
  onUpdateEmployees: (employees: Employee[]) => void;
  onNavigateToEmployee?: (employeeId: string) => void;
}

interface EmployeeCardProps {
  emp: Employee;
  onNavigateToEmployee?: (employeeId: string) => void;
  onEdit: (emp: Employee, e: React.MouseEvent) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onOpen1on1: (emp: Employee, e: React.MouseEvent) => void;
  onOpenDev: (emp: Employee, e: React.MouseEvent) => void;
}

const EmployeeCard: React.FC<EmployeeCardProps> = ({ emp, onNavigateToEmployee, onEdit, onDelete, onOpen1on1, onOpenDev }) => {
  const { t } = useLanguage();
  const isFuture = emp.type === 'future';
  
  return (
      <div 
          onClick={() => onNavigateToEmployee && onNavigateToEmployee(emp.id)}
          className={`
              bg-white rounded-xl border shadow-sm overflow-hidden hover:shadow-md transition-all group cursor-pointer
              ${isFuture ? 'border-dashed border-charcoal-300 bg-charcoal-50/50' : 'border-charcoal-200 hover:border-blue-200'}
          `}
      >
        <div className="p-5">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-4">
              {isFuture ? (
                   <div className="w-12 h-12 rounded-full border-2 border-dashed border-charcoal-300 flex items-center justify-center bg-white">
                       <UserPlus className="w-5 h-5 text-charcoal-400" />
                   </div>
              ) : (
                  <img src={emp.avatar} alt={emp.name} className="w-14 h-14 rounded-full border border-charcoal-100 object-cover" />
              )}
              
              <div>
                <h3 className={`font-semibold text-lg leading-tight group-hover:text-blue-600 transition-colors ${isFuture ? 'text-charcoal-600 italic' : 'text-charcoal-900'}`}>{emp.name}</h3>
                <p className="text-sm text-charcoal-500">{emp.role}</p>
              </div>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {!isFuture && (
                  <>
                  <button onClick={(e) => onOpenDev(emp, e)} className="p-1.5 text-charcoal-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors" title={t('team.openDevelopment')}>
                      <Target className="w-4 h-4" />
                  </button>
                  <button onClick={(e) => onOpen1on1(emp, e)} className="p-1.5 text-charcoal-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors" title={t('team.open1on1')}>
                      <MessageSquare className="w-4 h-4" />
                  </button>
                  </>
              )}
              <button onClick={(e) => onEdit(emp, e)} className="p-1.5 text-charcoal-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Edit2 className="w-4 h-4" /></button>
              <button onClick={(e) => onDelete(emp.id, e)} className="p-1.5 text-charcoal-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {emp.skills?.map(skill => (
                <span key={skill} className={`px-2 py-0.5 border text-xs rounded-md font-medium ${isFuture ? 'bg-white border-charcoal-200 text-charcoal-500' : 'bg-charcoal-50 border-charcoal-100 text-charcoal-600'}`}>
                  {skill}
                </span>
              ))}
              {(!emp.skills || emp.skills.length === 0) && <span className="text-xs text-charcoal-400 italic">{t('team.noSkills')}</span>}
            </div>

            {!isFuture && (
                <div className="space-y-2 pt-2 border-t border-charcoal-50">
                   <div className="flex justify-between">
                       <div className="flex items-center gap-2 text-sm text-charcoal-600">
                          <Star className="w-3.5 h-3.5" />
                          <span>{emp.availability}% {t('team.availability')}</span>
                       </div>
                       <div className="flex items-center gap-2 text-sm text-charcoal-600">
                          <MapPin className="w-3.5 h-3.5" />
                          <span className="font-medium">{emp.location || 'DE'}</span>
                       </div>
                   </div>
                </div>
            )}
            
            {emp.department && emp.type === 'external' && (
                <div className="pt-2 border-t border-charcoal-50 flex items-center gap-2 text-xs text-blue-600">
                    <Building2 className="w-3.5 h-3.5" />
                    {emp.department}
                </div>
            )}

            {isFuture && (
                <div className="pt-2 border-t border-dashed border-charcoal-200 text-xs text-charcoal-400 text-center">
                    Start Date: <span className="font-mono text-charcoal-600">Q2 2026</span>
                </div>
            )}
          </div>
        </div>
      </div>
  );
};

export const ManageTeam: React.FC<ManageTeamProps> = ({ 
    employees, 
    onUpdateEmployees, 
    onNavigateToEmployee,
    projects = [],
    assignments = []
}) => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'directory' | 'matrix'>('directory');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // 1:1 Dashboard State
  const [is1on1Open, setIs1on1Open] = useState(false);
  const [selectedEmpFor1on1, setSelectedEmpFor1on1] = useState<Employee | null>(null);

  // Development / Positioning State
  const [isDevOpen, setIsDevOpen] = useState(false);
  const [selectedEmpForDev, setSelectedEmpForDev] = useState<Employee | null>(null);
  
  // Form State
  const [formData, setFormData] = useState<Partial<Employee>>({
    name: '',
    role: '',
    avatar: '',
    skills: [],
    availability: 100,
    email: '',
    phone: '',
    notes: '',
    location: 'DE',
    type: 'internal',
    department: 'Software Engineering'
  });
  const [skillInput, setSkillInput] = useState('');

  // Categorize Employees
  const coreTeam = employees.filter(e => e.type === 'internal' || !e.type);
  const extendedTeam = employees.filter(e => e.type === 'external');
  const futureTeam = employees.filter(e => e.type === 'future');

  // Logic for Smart Suggestions
  const suggestions = useMemo(() => {
    // 1. Identify projects with gaps
    const activeProjects = projects.filter(p => p.status === 'active' || p.status === 'opportunity');
    const projectNeeds = activeProjects.map(p => {
        const allocatedDays = assignments.filter(a => a.projectId === p.id).length; // Simplified allocation
        const targetDays = p.volume || 0;
        const gap = targetDays - allocatedDays;
        
        // Very basic matching based on project topic/name vs skills
        const requiredSkills = [
            p.topic, 
            p.name.includes('App') ? 'React' : '', 
            p.name.includes('Cloud') ? 'AWS' : '',
            p.name.includes('Data') ? 'Python' : ''
        ].filter(Boolean) as string[];

        return { project: p, gap, requiredSkills };
    }).filter(n => n.gap > 0);

    const neededSkills = new Set(projectNeeds.flatMap(n => n.requiredSkills));
    
    // 2. Find matching employees from directory who are NOT already in the team
    return MOCK_COMPANY_DIRECTORY.filter(dirEmp => {
        const isAlreadyInTeam = employees.some(e => e.id === dirEmp.id);
        if (isAlreadyInTeam) return false;

        // Match score
        const matchCount = dirEmp.skills.filter(s => 
            Array.from(neededSkills).some(ns => s.toLowerCase().includes(ns.toLowerCase()))
        ).length;

        return matchCount > 0 || dirEmp.availability > 0; // Show available people too
    }).slice(0, 3); // Limit to top 3

  }, [projects, assignments, employees]);


  const handleEdit = (emp: Employee, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(emp.id);
    setFormData({ ...emp });
    setIsModalOpen(true);
  };

  const handleOpen1on1 = (emp: Employee, e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedEmpFor1on1(emp);
      setIs1on1Open(true);
  };

  const handleOpenDev = (emp: Employee, e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedEmpForDev(emp);
      setIsDevOpen(true);
  };

  const handleIkigaiUpdate = (items: IkigaiItem[]) => {
      if (!selectedEmpForDev) return;
      const updated = employees.map(e => e.id === selectedEmpForDev.id ? { ...e, ikigaiItems: items } : e);
      onUpdateEmployees(updated);
      setSelectedEmpForDev({ ...selectedEmpForDev, ikigaiItems: items });
  };

  const handleAdd = (type: 'internal' | 'future' = 'internal') => {
    setEditingId(null);
    setFormData({
      name: type === 'future' ? 'TBD' : '',
      role: '',
      avatar: type === 'future' ? '' : `https://ui-avatars.com/api/?name=New+User&background=random`,
      skills: [],
      availability: 100,
      email: '',
      phone: '',
      notes: '',
      location: 'DE',
      type: type,
      department: 'Software Engineering'
    });
    setIsModalOpen(true);
  };

  const handleRecruit = (dirEmp: Employee) => {
      const newEmp = { ...dirEmp, type: 'external' } as Employee;
      onUpdateEmployees([...employees, newEmp]);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(t('team.confirmDelete'))) {
      onUpdateEmployees(employees.filter(e => e.id !== id));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.role) return;

    if (editingId) {
      // Update
      const updated = employees.map(e => e.id === editingId ? { ...e, ...formData } as Employee : e);
      onUpdateEmployees(updated);
    } else {
      // Create
      const newEmp: Employee = {
        ...formData as Employee,
        id: Math.random().toString(36).substr(2, 9),
        avatar: formData.type === 'future' ? '' : (formData.avatar || `https://ui-avatars.com/api/?name=${formData.name}&background=random`)
      };
      onUpdateEmployees([...employees, newEmp]);
    }
    setIsModalOpen(false);
  };

  const handleAddSkill = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && skillInput.trim()) {
      e.preventDefault();
      setFormData(prev => ({
        ...prev,
        skills: [...(prev.skills || []), skillInput.trim()]
      }));
      setSkillInput('');
    }
  };

  const removeSkill = (skill: string) => {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills?.filter(s => s !== skill) || []
    }));
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, avatar: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="h-full overflow-auto bg-gray-50/50 p-6 custom-scrollbar">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-semibold text-charcoal-900 tracking-tight">{t('team.title')}</h1>
            <p className="text-charcoal-500 mt-1">{t('team.subtitle')}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => handleAdd('future')} variant="secondary" className="gap-2 border-dashed border-charcoal-300 text-charcoal-600 hover:text-blue-600 hover:border-blue-300 bg-white">
                <UserPlus className="w-4 h-4" /> {t('team.addFutureHire')}
            </Button>
            <Button onClick={() => handleAdd('internal')} className="gap-2">
                <Plus className="w-4 h-4" /> {t('team.addEmployee')}
            </Button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="bg-white p-1 rounded-lg border border-charcoal-200 inline-flex gap-1 shadow-sm">
            <button 
                onClick={() => setActiveTab('directory')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'directory' ? 'bg-charcoal-100 text-charcoal-900' : 'text-charcoal-500 hover:text-charcoal-700'}`}
            >
                {t('team.directory')}
            </button>
            <button 
                onClick={() => setActiveTab('matrix')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'matrix' ? 'bg-charcoal-100 text-charcoal-900' : 'text-charcoal-500 hover:text-charcoal-700'}`}
            >
                {t('team.skillMatrix')}
            </button>
        </div>
        
        {/* VIEW: SKILL MATRIX */}
        {activeTab === 'matrix' && (
             <TeamSkillMatrix employees={employees} />
        )}

        {/* VIEW: DIRECTORY */}
        {activeTab === 'directory' && (
        <div className="space-y-10">
            {/* Smart Suggestions Panel */}
            {suggestions.length > 0 && (
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <Sparkles className="w-5 h-5 text-blue-600" />
                        <div>
                            <h3 className="font-semibold text-blue-900">{t('team.smartRecruit')}</h3>
                            <p className="text-xs text-blue-600/80">{t('team.smartRecruitSubtitle')}</p>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {suggestions.map(emp => (
                            <div key={emp.id} className="bg-white/80 backdrop-blur-sm rounded-lg p-3 border border-blue-100 flex items-center justify-between shadow-sm">
                                <div className="flex items-center gap-3">
                                    <img src={emp.avatar} className="w-10 h-10 rounded-full border border-white shadow-sm" />
                                    <div>
                                        <div className="text-sm font-bold text-charcoal-800">{emp.name}</div>
                                        <div className="text-xs text-charcoal-500">{emp.role}</div>
                                        <div className="text-[10px] text-blue-600 mt-0.5">{emp.department}</div>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => handleRecruit(emp)}
                                    className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-colors"
                                    title={t('team.addToTeam')}
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 1. Core Team */}
            <div>
                <h3 className="text-sm font-bold text-charcoal-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Users className="w-4 h-4" /> {t('team.coreTeam')}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {coreTeam.map(emp => (
                    <EmployeeCard 
                        key={emp.id} 
                        emp={emp} 
                        onNavigateToEmployee={onNavigateToEmployee}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onOpen1on1={handleOpen1on1}
                        onOpenDev={handleOpenDev}
                    />
                    ))}
                </div>
            </div>

            {/* 2. Extended Team */}
            {extendedTeam.length > 0 && (
                <div>
                    <h3 className="text-sm font-bold text-charcoal-400 uppercase tracking-wider mb-4 flex items-center gap-2 border-t border-charcoal-200 pt-8">
                        <Building2 className="w-4 h-4" /> {t('team.extendedTeam')}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {extendedTeam.map(emp => (
                        <EmployeeCard 
                            key={emp.id} 
                            emp={emp} 
                            onNavigateToEmployee={onNavigateToEmployee}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onOpen1on1={handleOpen1on1}
                            onOpenDev={handleOpenDev}
                        />
                        ))}
                    </div>
                </div>
            )}

            {/* 3. Future Hiring */}
            {futureTeam.length > 0 && (
                <div>
                    <h3 className="text-sm font-bold text-charcoal-400 uppercase tracking-wider mb-4 flex items-center gap-2 border-t border-charcoal-200 pt-8">
                        <UserPlus className="w-4 h-4" /> {t('team.futureHiring')}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {futureTeam.map(emp => (
                        <EmployeeCard 
                            key={emp.id} 
                            emp={emp} 
                            onNavigateToEmployee={onNavigateToEmployee}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onOpen1on1={handleOpen1on1}
                            onOpenDev={handleOpenDev}
                        />
                        ))}
                    </div>
                </div>
            )}
        </div>
        )}

      </div>

      {/* Edit Employee Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? t('team.editEmployee') : (formData.type === 'future' ? t('team.addFutureHire') : t('team.addEmployee'))} size="lg">
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left Col - Avatar (Hide for future) */}
          <div className="md:col-span-1 flex flex-col items-center gap-4">
            {formData.type === 'future' ? (
                 <div className="w-32 h-32 rounded-full border-2 border-dashed border-charcoal-200 flex items-center justify-center bg-charcoal-50">
                     <UserPlus className="w-12 h-12 text-charcoal-300" />
                 </div>
            ) : (
                <>
                <div className="relative group w-32 h-32">
                <img src={formData.avatar} alt="Preview" className="w-32 h-32 rounded-full border-4 border-charcoal-50 object-cover shadow-sm" />
                <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                    <Upload className="w-8 h-8 text-white" />
                    <input type="file" accept="image/*" onChange={handleAvatarUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                </div>
                </div>
                <p className="text-xs text-charcoal-400 text-center">{t('team.uploadPhoto')}</p>
                </>
            )}
            
            <div className="w-full">
                 <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">Category</label>
                 <select 
                    className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm bg-charcoal-50"
                    value={formData.type}
                    onChange={e => setFormData({...formData, type: e.target.value as any})}
                 >
                     <option value="internal">Core Team</option>
                     <option value="external">Extended Team</option>
                     <option value="future">Future Hire</option>
                 </select>
            </div>
          </div>

          {/* Right Col - Fields */}
          <div className="md:col-span-2 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">{formData.type === 'future' ? 'Position Title' : t('team.name')}</label>
                <input required className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" 
                  value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder={t('team.placeholderName')} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">{t('team.role')}</label>
                <input required className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" 
                  value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} placeholder={t('team.placeholderRole')} />
              </div>
            </div>

            {formData.type !== 'future' && (
            <div className="grid grid-cols-2 gap-4">
               <div>
                  <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">{t('team.email')}</label>
                  <input type="email" className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" 
                    value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder={t('team.placeholderEmail')} />
               </div>
               <div>
                  <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">{t('team.phone')}</label>
                  <input type="tel" className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" 
                    value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder={t('team.placeholderPhone')} />
               </div>
            </div>
            )}

            <div className="grid grid-cols-2 gap-4">
                <div>
                   <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">
                      {t('team.availability')} ({formData.availability}%)
                   </label>
                   <input type="range" min="0" max="100" step="10" className="w-full h-2 bg-charcoal-100 rounded-lg appearance-none cursor-pointer accent-charcoal-800" 
                      value={formData.availability} onChange={e => setFormData({...formData, availability: Number(e.target.value)})} />
                   <div className="flex justify-between text-xs text-charcoal-400 mt-1">
                      <span>0%</span><span>50%</span><span>100%</span>
                   </div>
                </div>
                <div>
                   <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">
                      {t('team.location')}
                   </label>
                   <select 
                      className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-white"
                      value={formData.location}
                      onChange={e => setFormData({...formData, location: e.target.value})}
                   >
                       <option value="DE">Germany (DE)</option>
                       <option value="US">United States (US)</option>
                       <option value="UK">United Kingdom (UK)</option>
                   </select>
                </div>
            </div>
            
            {(formData.type === 'external' || formData.type === 'internal') && (
                <div>
                   <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">Department</label>
                   <input className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" 
                        value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})} placeholder="e.g. Engineering" />
                </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">{t('team.skills')}</label>
              <div className="border border-charcoal-200 rounded-lg p-2 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 bg-white">
                <div className="flex flex-wrap gap-2 mb-2">
                  {formData.skills?.map(skill => (
                    <span key={skill} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1">
                      {skill}
                      <button type="button" onClick={() => removeSkill(skill)} className="hover:text-blue-900"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
                <input 
                  className="w-full text-sm outline-none" 
                  placeholder={t('team.typeSkill')} 
                  value={skillInput}
                  onChange={e => setSkillInput(e.target.value)}
                  onKeyDown={handleAddSkill}
                />
              </div>
            </div>

            <div>
               <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">{t('team.notes')}</label>
               <textarea rows={3} className="w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none resize-none" 
                  value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} placeholder={t('team.placeholderNotes')} />
            </div>

            <div className="flex justify-end pt-4 gap-3">
              <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>{t('team.cancel')}</Button>
              <Button type="submit">{t('team.saveEmployee')}</Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* 1:1 Dashboard Modal */}
      {selectedEmpFor1on1 && (
        <OneOnOneDashboard 
            employee={selectedEmpFor1on1}
            isOpen={is1on1Open}
            onClose={() => setIs1on1Open(false)}
        />
      )}

      {/* Development / Positioning Modal */}
      {selectedEmpForDev && (
          <Modal isOpen={isDevOpen} onClose={() => setIsDevOpen(false)} title={t('development.title')} size="xl">
              <div className="flex flex-col h-[75vh]">
                  {/* Header */}
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-xl border border-blue-100 mb-6 flex items-center justify-between flex-shrink-0">
                      <div>
                          <h2 className="text-2xl font-bold text-charcoal-900">{selectedEmpForDev.name}</h2>
                          <div className="flex items-center gap-3 mt-2 text-sm text-charcoal-600">
                              <span className="flex items-center gap-1 bg-white px-2 py-1 rounded-md border border-blue-100 shadow-sm">
                                  <Briefcase className="w-4 h-4 text-blue-500" /> {selectedEmpForDev.role}
                              </span>
                              <span className="flex items-center gap-1 bg-white px-2 py-1 rounded-md border border-blue-100 shadow-sm">
                                  <MapPin className="w-4 h-4 text-blue-500" /> {selectedEmpForDev.location}
                              </span>
                          </div>
                      </div>
                      <div className="text-right">
                          <div className="text-xs font-bold text-charcoal-500 uppercase tracking-wider mb-1">Target Utilization</div>
                          <div className="text-2xl font-light text-blue-600">{selectedEmpForDev.availability}%</div>
                      </div>
                  </div>

                  {/* Main Content Grid */}
                  <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          {/* Competencies */}
                          <div className="bg-white border border-charcoal-200 rounded-xl p-6 shadow-sm flex flex-col">
                              <div className="flex justify-between items-start mb-6">
                                  <div>
                                      <h3 className="text-lg font-bold text-charcoal-800 flex items-center gap-2">
                                          <Target className="w-5 h-5 text-blue-600" />
                                          {t('development.competencies')}
                                      </h3>
                                      <p className="text-xs text-charcoal-500 mt-1">Self vs. Manager Assessment</p>
                                  </div>
                              </div>
                              <div className="flex-1 flex items-center justify-center bg-charcoal-50/50 rounded-lg border border-charcoal-100 p-4">
                                  <CompetencyRadar competencies={selectedEmpForDev.competencies || []} />
                              </div>
                          </div>

                          {/* Ikigai */}
                          <div className="bg-white border border-charcoal-200 rounded-xl p-6 shadow-sm flex flex-col">
                              <div className="flex justify-between items-start mb-6">
                                  <div>
                                      <h3 className="text-lg font-bold text-charcoal-800 flex items-center gap-2">
                                          <Sparkles className="w-5 h-5 text-yellow-500" />
                                          {t('development.ikigai')}
                                      </h3>
                                      <p className="text-xs text-charcoal-500 mt-1">Purpose & Motivation Alignment</p>
                                  </div>
                              </div>
                              <div className="flex-1 bg-yellow-50/30 rounded-lg border border-yellow-100 p-4">
                                  <IkigaiBuilder items={selectedEmpForDev.ikigaiItems || []} onUpdate={handleIkigaiUpdate} />
                              </div>
                          </div>
                          
                          {/* Development Goals / Next Steps (Placeholder for UI completeness) */}
                          <div className="lg:col-span-2 bg-charcoal-50 border border-charcoal-200 rounded-xl p-6 shadow-sm">
                              <h3 className="text-sm font-bold text-charcoal-800 uppercase tracking-wider mb-4 flex items-center gap-2">
                                  <TrendingUp className="w-4 h-4 text-green-600" />
                                  Development Goals & Next Steps
                              </h3>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                  <div className="bg-white p-4 rounded-lg border border-charcoal-100 shadow-sm">
                                      <div className="text-xs font-bold text-blue-600 mb-1">Short-term (Q2 2026)</div>
                                      <div className="text-sm text-charcoal-700">Improve technical leadership in React/Node.js stack. Lead one internal workshop.</div>
                                  </div>
                                  <div className="bg-white p-4 rounded-lg border border-charcoal-100 shadow-sm">
                                      <div className="text-xs font-bold text-purple-600 mb-1">Mid-term (2026)</div>
                                      <div className="text-sm text-charcoal-700">Transition into a Software Architect role. Certify in AWS Solutions Architect.</div>
                                  </div>
                                  <div className="bg-white p-4 rounded-lg border border-charcoal-100 shadow-sm flex items-center justify-center border-dashed">
                                      <button className="text-sm text-charcoal-400 hover:text-blue-600 flex items-center gap-1">
                                          <Plus className="w-4 h-4" /> Add Goal
                                      </button>
                                  </div>
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
          </Modal>
      )}
    </div>
  );
};
