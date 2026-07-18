

import React, { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { CalendarDays, BarChart3, Settings, Users, Layers, History, Plus, Globe, Clock, Building2, Sparkles, Key, ExternalLink, PieChart, Home, UserCircle, Bot, BotOff, Trash2, CookingPot, BookMarked, GitCommit, Terminal, Cpu, Zap, Shield, Activity, Target, Compass } from 'lucide-react';
import { PlanVersion, UserRole } from '../types';
import { useLanguage } from '../contexts/LanguageContext';

const BUILD_DATE = '2026-07-18';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { AsciiSpinner } from './ui/AsciiSpinner';

interface SidebarProps {
  versions: PlanVersion[];
  activeVersionId: string;
  onSelectVersion: (id: string) => void;
  onCreateVersion: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  versions,
  activeVersionId,
  onSelectVersion,
  onCreateVersion
}) => {
  const { t, language, setLanguage, formatDate } = useLanguage();
  const { apiKey, setApiKey, isAiEnabled, setIsAiEnabled, isSettingsModalOpen, openSettings, closeSettings } = useSettings();
  const { user, loginAs, isRole } = useAuth();
  const navigate = useNavigate();
  
  const [isRoleSwitcherOpen, setIsRoleSwitcherOpen] = useState(false);
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);

  // Local state for Settings Modal
  const [localLang, setLocalLang] = useState(language);
  const [localAiEnabled, setLocalAiEnabled] = useState(isAiEnabled);
  const [localApiKey, setLocalApiKey] = useState(apiKey);

  // Sync local state when modal opens
  useEffect(() => {
    if (isSettingsModalOpen) {
        setLocalLang(language);
        setLocalAiEnabled(isAiEnabled);
        setLocalApiKey(apiKey);
    }
  }, [isSettingsModalOpen, language, isAiEnabled, apiKey]);

  const handleSaveSettings = () => {
      setLanguage(localLang);
      setIsAiEnabled(localAiEnabled);
      setApiKey(localApiKey);
      closeSettings();
  };

  // Navigation Logic
  const getMenuItems = () => {
    const items = [];
    if (isRole('employee')) {
       items.push({ path: '/my-overview', label: t('sidebar.myOverview'), icon: Home });
    }
    
    // Everyone sees Resource Plan (Read-only for Emp)
    items.push({ path: '/planner', label: t('sidebar.resourcePlan'), icon: CalendarDays });

    // Sales Pipeline: Sales Only
    if (isRole('sales')) {
        items.push({ path: '/sales-pipeline', label: t('sidebar.salesPipeline'), icon: Target });
    }

    // Forecast: PM and BL only
    if (isRole(['pm', 'bl'])) {
        items.push({ path: '/forecast', label: t('sidebar.quarterlyForecast'), icon: BarChart3 });
    }

    // Financials: BL mainly, PM allowed (Moved to Planning section)
    if (isRole(['pm', 'bl'])) {
        items.push({ path: '/financials', label: t('sidebar.financials'), icon: PieChart });
    }

    // Strategy: PM and BL only
    if (isRole(['pm', 'bl'])) {
        items.push({ path: '/strategy', label: t('sidebar.strategy'), icon: Compass });
    }

    return items;
  };

  const getManageItems = () => {
     const items = [];
     
     // Team: PM and BL
     if (isRole(['pm', 'bl'])) {
        items.push({ path: '/team', label: t('sidebar.team'), icon: Users });
     }
     
     // Projects: PM and BL and Sales
     if (isRole(['pm', 'bl', 'sales'])) {
         items.push({ path: '/projects', label: t('sidebar.projects'), icon: Layers });
     }
     
     // Customers: All can see (read only for emp)
     items.push({ path: '/customers', label: t('sidebar.customers'), icon: Building2 });

     return items;
  };

  const menuItems = getMenuItems();
  const manageItems = getManageItems();

  return (
    <>
    <div className="w-64 bg-charcoal-50/50 backdrop-blur-xl border-r border-charcoal-200 flex flex-col h-full flex-shrink-0 z-20 shadow-[1px_0_10px_rgba(0,0,0,0.03)]">
      <div className="p-6 flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-3 mb-8 flex-shrink-0 animate-fade-in">
            <div className="w-8 h-8 bg-gradient-to-br from-charcoal-700 to-charcoal-900 rounded-lg flex items-center justify-center text-white shadow-md ring-1 ring-charcoal-400/20">
                <CookingPot className="w-5 h-5" />
            </div>
            <span className="font-semibold text-charcoal-900 tracking-tight text-lg font-mono">IBs QFC Kitchen</span>
        </div>

        {/* Main Nav */}
        <nav className="space-y-1 flex-shrink-0 animate-slide-in-right" style={{ animationDelay: '0.1s' }}>
          <div className="text-xs font-bold text-charcoal-400 uppercase tracking-widest mb-3 px-3 font-mono opacity-80">{t('sidebar.planning')}</div>
          {menuItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 group
                ${isActive 
                  ? 'bg-white text-charcoal-900 shadow-sm ring-1 ring-charcoal-200 translate-x-1' 
                  : 'text-charcoal-500 hover:text-charcoal-900 hover:bg-charcoal-100 hover:translate-x-1'
                }
              `}
            >
              {({ isActive }) => (
                <>
                  <item.icon className={`w-4 h-4 transition-colors ${isActive ? 'text-charcoal-800' : 'text-charcoal-400 group-hover:text-charcoal-600'}`} />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {manageItems.length > 0 && (
        <nav className="space-y-1 mt-8 flex-shrink-0 animate-slide-in-right" style={{ animationDelay: '0.2s' }}>
            <div className="text-xs font-bold text-charcoal-400 uppercase tracking-widest mb-3 px-3 font-mono opacity-80">{t('sidebar.manage')}</div>
            {manageItems.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => `w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 group
                  ${isActive 
                    ? 'bg-white text-charcoal-900 shadow-sm ring-1 ring-charcoal-200 translate-x-1' 
                    : 'text-charcoal-500 hover:text-charcoal-900 hover:bg-charcoal-100 hover:translate-x-1'
                  }
                `}
              >
                {({ isActive }) => (
                  <>
                    <item.icon className={`w-4 h-4 transition-colors ${isActive ? 'text-charcoal-800' : 'text-charcoal-400 group-hover:text-charcoal-600'}`} />
                    {item.label}
                  </>
                )}
              </NavLink>
            ))}
        </nav>
        )}

        {/* Version History */}
        {!isRole('employee') && (
        <div className="mt-8 flex-1 flex flex-col min-h-0 animate-slide-in-right" style={{ animationDelay: '0.3s' }}>
          <div className="flex items-center justify-between px-3 mb-4 flex-shrink-0">
             <div className="text-xs font-bold text-charcoal-400 uppercase tracking-widest flex items-center gap-2 font-mono opacity-80">
                <History className="w-3 h-3" /> {t('sidebar.versions')}
             </div>
             <button 
                onClick={onCreateVersion}
                className="text-charcoal-400 hover:text-blue-600 p-1.5 rounded-md hover:bg-blue-50 transition-colors hover:scale-110 active:scale-95"
                title={t('sidebar.saveNewVersion')}
              >
                <Plus className="w-3.5 h-3.5" />
             </button>
          </div>
          
          <div className="relative flex-1 overflow-y-auto custom-scrollbar px-2 pb-2"> 
             {/* Timeline Container */}
             <div className="relative pt-2">
                {/* Vertical Timeline Line */}
                <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-charcoal-200 via-charcoal-200 to-transparent" />

                <div className="space-y-1 relative">
                  {versions.slice().reverse().map((version, index) => {
                      const isActive = activeVersionId === version.id;
                      const isLatest = index === 0;

                      return (
                          <div key={version.id} className="relative pl-12 group">
                              {/* Horizontal Connector Line */}
                              <div className={`absolute left-6 top-[1.2rem] w-6 h-px transition-all duration-300 ${isActive ? 'bg-blue-300 w-6' : 'bg-charcoal-200 w-4 group-hover:w-6 group-hover:bg-charcoal-300'}`} />

                              {/* Timeline Node/Dot */}
                              <div 
                                  className={`absolute left-[19px] top-3.5 w-2.5 h-2.5 rounded-full border-2 transition-all duration-300 z-10
                                      ${isActive 
                                      ? 'bg-blue-600 border-white ring-2 ring-blue-100 shadow-sm scale-110' 
                                      : 'bg-charcoal-50 border-charcoal-300 group-hover:border-charcoal-400 group-hover:bg-charcoal-200'}
                                  `}
                              />
                              
                              {/* Content Card */}
                              <button 
                                  onClick={() => onSelectVersion(version.id)}
                                  className={`text-left w-full transition-all duration-200 rounded-lg p-3 border group-hover:translate-x-1
                                      ${isActive 
                                          ? 'bg-white border-charcoal-200 shadow-sm' 
                                          : 'bg-transparent border-transparent hover:bg-white/50 hover:border-charcoal-100'}
                                  `}
                              >
                                  <div className="flex items-center justify-between gap-2">
                                      <div className={`text-sm font-medium leading-tight ${isActive ? 'text-charcoal-900' : 'text-charcoal-600'}`}>
                                          {version.name}
                                      </div>
                                      {isLatest && (
                                          <span className="text-[8px] font-bold text-blue-600 bg-blue-50/50 px-1.5 py-0.5 rounded-full border border-blue-100/50 uppercase tracking-wide ml-auto">
                                            {t('sidebar.latest')}
                                          </span>
                                      )}
                                  </div>
                                  <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-charcoal-400">
                                      <Clock className="w-3 h-3 opacity-60" />
                                      <span className="font-mono">{formatDate(new Date(version.createdAt), 'MMM d, HH:mm')}</span>
                                  </div>
                              </button>
                          </div>
                      );
                  })}
                </div>
             </div>
          </div>
        </div>
        )}

      </div>

      <div className="p-4 border-t border-charcoal-200 bg-charcoal-50/80 backdrop-blur flex-shrink-0 relative">
        <div className="flex items-center justify-between">
            <button 
                onClick={openSettings}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-charcoal-500 hover:text-charcoal-900 hover:bg-charcoal-100 transition-all duration-200 hover:shadow-sm"
            >
              <Settings className="w-4 h-4 transition-transform hover:rotate-45 duration-500" />
              {t('sidebar.settings')}
            </button>
            <button 
                onClick={() => setIsChangelogOpen(true)}
                className="text-[10px] text-charcoal-400 font-mono pr-2 opacity-50 hover:opacity-100 hover:text-blue-600 transition-all cursor-pointer"
            >
                v1.3.0
            </button>
        </div>
        
        {/* User Profile / Role Switcher Trigger */}
        <button 
            onClick={() => setIsRoleSwitcherOpen(!isRoleSwitcherOpen)}
            className="mt-4 w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-charcoal-100 transition-all duration-200 text-left hover:shadow-sm border border-transparent hover:border-charcoal-200"
        >
            <img src={user.avatar} alt="User" className="w-8 h-8 rounded-full border border-charcoal-200" />
            <div className="flex-1 min-w-0">
                <div className="font-medium text-charcoal-900 text-xs truncate">{user.name}</div>
                <div className="text-charcoal-500 text-[10px] uppercase truncate font-mono">{t(`roles.${user.role}`)}</div>
            </div>
            <UserCircle className="w-4 h-4 text-charcoal-400" />
        </button>

        {/* Role Switcher Popover */}
        {isRoleSwitcherOpen && (
            <>
            <div className="fixed inset-0 z-40" onClick={() => setIsRoleSwitcherOpen(false)} />
            <div className="absolute bottom-full left-4 right-4 mb-2 bg-white rounded-xl shadow-xl border border-charcoal-200 p-2 z-50 animate-in slide-in-from-bottom-2 fade-in zoom-in-95 duration-200">
                <div className="text-xs font-bold text-charcoal-400 uppercase tracking-widest px-2 py-2 border-b border-charcoal-100 mb-1 font-mono">
                    {t('sidebar.switchRole')}
                </div>
                {['pm', 'employee', 'bl', 'sales'].map((role) => (
                    <button
                        key={role}
                        onClick={() => {
                            loginAs(role as UserRole);
                            setIsRoleSwitcherOpen(false);
                            // Navigate based on role
                            if (role === 'sales') {
                                navigate('/sales-pipeline');
                            } else {
                                navigate(role === 'employee' ? '/my-overview' : '/planner');
                            }
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between
                            ${user.role === role ? 'bg-blue-50 text-blue-700 font-medium' : 'text-charcoal-600 hover:bg-charcoal-50'}
                        `}
                    >
                        {t(`roles.${role}`)}
                        {user.role === role && <div className="w-2 h-2 rounded-full bg-blue-600 animate-pulse-subtle" />}
                    </button>
                ))}
            </div>
            </>
        )}
      </div>
    </div>

    {/* Settings Modal */}
    <Modal isOpen={isSettingsModalOpen} onClose={closeSettings} title={t('sidebar.settings')} size="sm">
        <div className="space-y-6">
            
            {/* Language Section */}
            <div>
                <h4 className="text-sm font-medium text-charcoal-900 mb-3 flex items-center gap-2">
                    <Globe className="w-4 h-4" /> {t('sidebar.language')}
                </h4>
                <div className="grid grid-cols-2 gap-3">
                    <button 
                        onClick={() => setLocalLang('en')}
                        className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border text-sm font-medium transition-all ${
                            localLang === 'en' 
                            ? 'bg-blue-50 border-blue-200 text-blue-700 ring-1 ring-blue-500/20' 
                            : 'bg-white border-charcoal-200 text-charcoal-600 hover:bg-charcoal-50'
                        }`}
                    >
                        <span>🇺🇸</span> English
                    </button>
                    <button 
                        onClick={() => setLocalLang('de')}
                        className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border text-sm font-medium transition-all ${
                            localLang === 'de' 
                            ? 'bg-blue-50 border-blue-200 text-blue-700 ring-1 ring-blue-500/20' 
                            : 'bg-white border-charcoal-200 text-charcoal-600 hover:bg-charcoal-50'
                        }`}
                    >
                        <span>🇩🇪</span> Deutsch
                    </button>
                </div>
            </div>

            <div className="h-px bg-charcoal-100"></div>

            {/* AI Configuration Section */}
            <div>
                <h4 className="text-sm font-medium text-charcoal-900 mb-3 flex items-center gap-2">
                    {localAiEnabled ? <Bot className="w-4 h-4 text-blue-600" /> : <BotOff className="w-4 h-4 text-charcoal-400" />}
                    {t('sidebar.aiConfig')}
                </h4>
                
                <div className="bg-charcoal-50 rounded-xl p-4 border border-charcoal-100 space-y-4">
                    {/* Toggle */}
                    <div className="flex items-center justify-between">
                         <label htmlFor="ai-toggle" className="text-sm font-medium text-charcoal-700 cursor-pointer select-none">
                            {t('sidebar.enableAI')}
                         </label>
                         <div className="relative inline-block w-10 h-5 align-middle select-none transition duration-200 ease-in">
                            <input 
                                type="checkbox" 
                                name="toggle" 
                                id="ai-toggle" 
                                className="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 appearance-none cursor-pointer transition-transform duration-200 ease-in-out checked:translate-x-5 checked:border-blue-600 border-charcoal-300"
                                checked={localAiEnabled}
                                onChange={(e) => setLocalAiEnabled(e.target.checked)}
                            />
                            <label htmlFor="ai-toggle" className={`toggle-label block overflow-hidden h-5 rounded-full cursor-pointer transition-colors duration-200 ${localAiEnabled ? 'bg-blue-200' : 'bg-charcoal-200'}`}></label>
                         </div>
                    </div>
                    
                    {localAiEnabled && (
                        <div className="animate-fade-in-up">
                             <label className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">{t('sidebar.apiKey')}</label>
                             <div className="flex gap-2">
                                 <div className="relative flex-1">
                                     <input 
                                         type="password"
                                         value={localApiKey}
                                         onChange={(e) => setLocalApiKey(e.target.value)}
                                         placeholder={t('sidebar.apiKeyPlaceholder')}
                                         className="w-full pl-9 pr-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all bg-white"
                                     />
                                     <Key className="absolute left-3 top-2.5 w-4 h-4 text-charcoal-400 pointer-events-none" />
                                 </div>
                                 {localApiKey && (
                                     <button 
                                        onClick={() => setLocalApiKey('')}
                                        className="p-2 text-charcoal-400 hover:text-red-600 hover:bg-red-50 rounded-lg border border-charcoal-200 hover:border-red-200 transition-colors"
                                        title={t('sidebar.clearApiKey')}
                                     >
                                         <Trash2 className="w-4 h-4" />
                                     </button>
                                 )}
                             </div>
                             <a 
                                href="https://aistudio.google.com/app/apikey" 
                                target="_blank" 
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-2 ml-1"
                             >
                                {t('sidebar.getKey')} <ExternalLink className="w-3 h-3" />
                             </a>
                        </div>
                    )}
                </div>
            </div>
            
            <div className="pt-2 flex justify-end gap-3">
                <Button variant="ghost" onClick={closeSettings}>{t('sidebar.close')}</Button>
                <Button onClick={handleSaveSettings}>{t('sidebar.saveSettings')}</Button>
            </div>
        </div>
    </Modal>

    {/* Changelog Modal */}
    <Modal isOpen={isChangelogOpen} onClose={() => setIsChangelogOpen(false)} title={t('sidebar.changelogTitle')} size="lg">
        <div className="relative bg-white rounded-lg overflow-hidden border border-charcoal-200 text-charcoal-800 font-mono shadow-[0_0_50px_rgba(0,0,0,0.05)]">
            {/* Background Effects */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(16,185,129,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-emerald-500 to-transparent animate-scan z-20 opacity-50"></div>

            {/* Header */}
            <div className="relative z-10 p-6 border-b border-charcoal-100 flex justify-between items-start bg-charcoal-50/50 backdrop-blur-sm">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <BookMarked className="w-6 h-6 text-emerald-600" />
                        <h2 className="text-xl font-bold tracking-widest text-emerald-900">{t('changelog.title')}</h2>
                    </div>
                    <div className="flex gap-4 text-xs text-charcoal-500">
                        <div className="flex items-center gap-1.5">
                            <GitCommit className="w-3 h-3" />
                            <span>{t('changelog.build')}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Clock className="w-3 h-3" />
                            <span>{new Date(BUILD_DATE).toLocaleDateString()}</span>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 border border-emerald-200 rounded text-xs font-bold text-emerald-700">
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                        {t('changelog.systemOnline')}
                    </div>
                    <span className="text-[10px] text-charcoal-400">{t('changelog.id')}</span>
                </div>
            </div>

            {/* Terminal Content */}
            <div className="relative z-10 p-6 space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                
                {/* Sales Feature Block */}
                <div className="space-y-3 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
                    <div className="flex items-center gap-2 text-sm font-bold text-orange-700 border-b border-orange-100 pb-1 mb-2">
                        <Target className="w-4 h-4" />
                        <span>{t('changelog.salesModuleActivated')}</span>
                    </div>
                    <ul className="space-y-2 text-xs leading-relaxed text-charcoal-600">
                         <li className="flex gap-3 items-start group">
                            <span className="text-orange-600 mt-0.5 group-hover:text-orange-500 transition-colors">➜</span>
                            <div>
                                <strong className="text-charcoal-900 block mb-0.5">{t('changelog.salesPipelineDashboard')}</strong>
                                {t('changelog.salesPipelineDesc')}
                            </div>
                        </li>
                        <li className="flex gap-3 items-start group">
                            <span className="text-orange-600 mt-0.5 group-hover:text-orange-500 transition-colors">➜</span>
                            <div>
                                <strong className="text-charcoal-900 block mb-0.5">{t('changelog.marketTrendsScout')}</strong>
                                {t('changelog.marketTrendsDesc')}
                            </div>
                        </li>
                    </ul>
                </div>
                
                {/* Footer Command Line */}
                <div className="pt-4 border-t border-charcoal-100 flex items-center gap-2 text-xs font-mono opacity-80 bg-charcoal-50 -mx-6 px-6 -mb-6 py-3">
                    <Terminal className="w-3 h-3 text-emerald-600" />
                    <span className="text-charcoal-500">{t('changelog.rootPrompt')}</span>
                    <span className="text-emerald-600 animate-pulse">_</span>
                </div>

            </div>
            
            {/* Corner Accents */}
            <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-blue-500/20 rounded-tl-lg pointer-events-none"></div>
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-blue-500/20 rounded-br-lg pointer-events-none"></div>
        </div>
    </Modal>
    </>
  );
};