import React from 'react';
import { AlertTriangle, Database, Users, Clock, Info } from 'lucide-react';

import { useLanguage } from '../../contexts/LanguageContext';
import { useSystemStatus } from '../../api/useAdmin';
import { PageHeader } from '../ui/PageHeader';
import { Button } from '../ui/Button';
import { AsciiSpinner } from '../ui/AsciiSpinner';

/** Milliseconds between status polls - must match the hook default used below. */
const POLL_MS = 15000;

/** Compact uptime like `2d 4h` / `4h 12m` / `7m` - two units are plenty for an ops glance. */
function formatUptime(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

const StatCard: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({ label, value, hint }) => (
  <div className="bg-white rounded-xl border border-charcoal-200 shadow-sm p-4">
    <div className="text-xs font-semibold text-charcoal-500 uppercase tracking-wider">{label}</div>
    <div className="mt-1.5 text-lg font-semibold text-charcoal-900 truncate">{value}</div>
    {hint && <div className="mt-1 text-xs text-charcoal-400 truncate">{hint}</div>}
  </div>
);

/**
 * Monitoring tab of the admin area: server/runtime cards on top, the entity
 * row counts as a compact grid, and the change-log fill level as a progress
 * bar against its retention cap (the metric an admin actually watches -
 * oldest events get dropped once the cap is hit). `useSystemStatus` polls;
 * this component only renders the latest snapshot plus when it arrived.
 */
export const SystemStatus: React.FC = () => {
  const { t } = useLanguage();
  const { systemStatus, status, lastUpdatedAtMillis, refresh } = useSystemStatus(POLL_MS);

  if (status === 'loading') {
    return (
      <div className="h-full overflow-auto bg-gray-50/50 p-6 custom-scrollbar">
        <div className="flex flex-col items-center justify-center py-16 text-charcoal-500 gap-2">
          <AsciiSpinner className="text-xl" />
          <span className="text-sm font-medium">{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  if (status === 'error' || !systemStatus) {
    return (
      <div className="h-full overflow-auto bg-gray-50/50 p-6 custom-scrollbar">
        <div className="text-center py-16 space-y-3">
          <p className="text-sm text-red-600">{t('common.loadError')}</p>
          <Button variant="secondary" onClick={() => void refresh()}>{t('admin.retry')}</Button>
        </div>
      </div>
    );
  }

  const { entities, changeLog } = systemStatus;
  // Guard against a configured-but-zero cap: without it the ratio is NaN.
  const retentionRatio = changeLog.retentionRows > 0 ? changeLog.rows / changeLog.retentionRows : 0;
  const retentionPercent = Math.min(100, Math.round(retentionRatio * 100));

  const entityEntries: ReadonlyArray<{ key: keyof typeof entities; label: string }> = [
    { key: 'users', label: t('admin.monitoring.entities.users') },
    { key: 'employees', label: t('admin.monitoring.entities.employees') },
    { key: 'customers', label: t('admin.monitoring.entities.customers') },
    { key: 'projects', label: t('admin.monitoring.entities.projects') },
    { key: 'planVersions', label: t('admin.monitoring.entities.planVersions') },
    { key: 'assignments', label: t('admin.monitoring.entities.assignments') },
    { key: 'absences', label: t('admin.monitoring.entities.absences') },
    { key: 'quarterData', label: t('admin.monitoring.entities.quarterData') },
    { key: 'strategicGoals', label: t('admin.monitoring.entities.strategicGoals') },
    { key: 'northStarMetrics', label: t('admin.monitoring.entities.northStarMetrics') },
    { key: 'oneOnOneSessions', label: t('admin.monitoring.entities.oneOnOneSessions') },
    { key: 'publicHolidays', label: t('admin.monitoring.entities.publicHolidays') },
  ];

  return (
    <div className="h-full overflow-auto bg-gray-50/50 p-6 custom-scrollbar">
      <div className="max-w-5xl mx-auto space-y-8">
        <PageHeader title={t('admin.monitoring.title')} subtitle={t('admin.monitoring.subtitle')} />

        {systemStatus.devUserMode && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm font-medium rounded-xl px-4 py-3">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {t('admin.monitoring.devModeWarning')}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label={t('admin.monitoring.uptime')}
            value={
              <span className="inline-flex items-center gap-2">
                <Clock className="w-4 h-4 text-charcoal-400" />
                {formatUptime(systemStatus.serverTimeMillis - systemStatus.serverStartedAtMillis)}
              </span>
            }
          />
          <StatCard
            label={t('admin.monitoring.version')}
            value={
              <span className="inline-flex items-center gap-2">
                <Info className="w-4 h-4 text-charcoal-400" />
                {systemStatus.version}
              </span>
            }
          />
          <StatCard
            label={t('admin.monitoring.dbSize')}
            value={
              <span className="inline-flex items-center gap-2">
                <Database className="w-4 h-4 text-charcoal-400" />
                {formatBytes(systemStatus.dbSizeBytes)}
              </span>
            }
            hint={systemStatus.dbPath}
          />
          <StatCard
            label={t('admin.monitoring.liveClients')}
            value={
              <span className="inline-flex items-center gap-2">
                <Users className="w-4 h-4 text-charcoal-400" />
                {systemStatus.activeWatchSubscriptions}
              </span>
            }
          />
        </div>

        <div>
          <h2 className="text-sm font-semibold text-charcoal-700 uppercase tracking-wider mb-3">
            {t('admin.monitoring.entitiesTitle')}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {entityEntries.map(entry => (
              <div key={entry.key} className="bg-white rounded-lg border border-charcoal-200 px-3 py-2 flex items-baseline justify-between">
                <span className="text-xs text-charcoal-500 truncate">{entry.label}</span>
                <span className="text-sm font-semibold text-charcoal-900 tabular-nums">{entities[entry.key]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-charcoal-200 shadow-sm p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-charcoal-700 uppercase tracking-wider">
              {t('admin.monitoring.changeLogTitle')}
            </h2>
            <span className="text-xs text-charcoal-500">
              {t('admin.monitoring.changeLogSeqRange')}: {changeLog.rows > 0 ? `${changeLog.oldestSeq} – ${changeLog.newestSeq}` : '—'}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={retentionPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2.5 rounded-full bg-charcoal-100 overflow-hidden"
          >
            <div
              className={`h-full rounded-full transition-all ${retentionRatio > 0.9 ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${retentionPercent}%` }}
            />
          </div>
          <div className="flex items-baseline justify-between text-xs text-charcoal-500">
            <span>{t('admin.monitoring.changeLogRows')}: {changeLog.rows}</span>
            <span>{t('admin.monitoring.changeLogRetention')}: {changeLog.retentionRows} ({retentionPercent}%)</span>
          </div>
        </div>

        {lastUpdatedAtMillis !== undefined && (
          <p className="text-xs text-charcoal-400 text-right">
            {t('admin.monitoring.lastUpdated')}: {new Date(lastUpdatedAtMillis).toLocaleTimeString()}
            {' · '}
            {t('admin.monitoring.autoRefresh')}: {Math.round(POLL_MS / 1000)}s
          </p>
        )}
      </div>
    </div>
  );
};
