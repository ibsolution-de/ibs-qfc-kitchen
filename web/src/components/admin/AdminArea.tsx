import React, { useState } from 'react';
import { Users, Settings, Activity } from 'lucide-react';

import type { Employee } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { ManageUsers } from '../ManageUsers';
import { ApplicationSetup } from './ApplicationSetup';
import { SystemStatus } from './SystemStatus';

type AdminTab = 'users' | 'setup' | 'monitoring';

interface AdminAreaProps {
  employees: Employee[];
}

/**
 * Shell for the `/admin` route: a tab switcher (same segmented-control
 * pattern as ManageTeam) over the three admin surfaces. `ManageUsers` stays
 * a self-contained page (own header, own scroll container) and simply
 * becomes the first tab's content; the two new tabs follow the same
 * full-height container convention so the switcher itself never scrolls
 * away.
 */
export const AdminArea: React.FC<AdminAreaProps> = ({ employees }) => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  const tabs: ReadonlyArray<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
    { id: 'users', label: t('admin.tabs.users'), icon: <Users className="w-4 h-4" /> },
    { id: 'setup', label: t('admin.tabs.setup'), icon: <Settings className="w-4 h-4" /> },
    { id: 'monitoring', label: t('admin.tabs.monitoring'), icon: <Activity className="w-4 h-4" /> },
  ];

  return (
    <div className="h-full flex flex-col bg-gray-50/50">
      <div className="px-6 pt-6 pb-2 flex-shrink-0">
        <div className="max-w-5xl mx-auto">
          <div className="bg-white p-1 rounded-lg border border-charcoal-200 inline-flex gap-1 shadow-sm">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${
                  activeTab === tab.id
                    ? 'bg-charcoal-100 text-charcoal-900'
                    : 'text-charcoal-500 hover:text-charcoal-700'
                }`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {activeTab === 'users' && <ManageUsers employees={employees} />}
        {activeTab === 'setup' && <ApplicationSetup />}
        {activeTab === 'monitoring' && <SystemStatus />}
      </div>
    </div>
  );
};
