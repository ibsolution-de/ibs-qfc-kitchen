import { useCallback, useEffect, useState } from 'react';

import { adminClient } from './clients';
import { userRoleMapping } from './adapters';
import type { UserRole } from '../types';

export type UseAdminStatus = 'loading' | 'ready' | 'error';

/**
 * Domain-facing view of `SystemStatus`: every `int64` arrives as a `bigint`
 * on the wire, but these are row counts, byte sizes, and millisecond
 * timestamps - all far below 2^53, so `Number()` is exact and saves every
 * consumer from bigint arithmetic. Nothing here exposes a generated type.
 */
export interface EntityCountsView {
  users: number;
  employees: number;
  customers: number;
  projects: number;
  planVersions: number;
  assignments: number;
  absences: number;
  quarterData: number;
  strategicGoals: number;
  northStarMetrics: number;
  oneOnOneSessions: number;
  publicHolidays: number;
}

export interface ChangeLogStatsView {
  rows: number;
  oldestSeq: number;
  newestSeq: number;
  retentionRows: number;
}

export interface SystemStatusView {
  serverStartedAtMillis: number;
  serverTimeMillis: number;
  version: string;
  dbPath: string;
  dbSizeBytes: number;
  devUserMode: boolean;
  activeWatchSubscriptions: number;
  entities: EntityCountsView;
  changeLog: ChangeLogStatsView;
}

export interface UseSystemStatusResult {
  systemStatus: SystemStatusView | undefined;
  status: UseAdminStatus;
  /** Message for the most recent load failure; cleared once things recover. */
  error: string | undefined;
  /** Client clock (`Date.now()`) of the last successful fetch, for "last updated" displays. */
  lastUpdatedAtMillis: number | undefined;
  refresh: () => Promise<void>;
}

/** The editable fields of the application settings. */
export interface AppSettingsValues {
  defaultRole: UserRole;
  adminEmails: string[];
}

/**
 * `effective` is flattened to the top level; `environment` keeps the startup
 * values so the UI can show what a DB override shadows. `*_Overridden` says
 * whether the effective value comes from the `meta` table (true) or the
 * startup environment (false).
 */
export interface AppSettingsView extends AppSettingsValues {
  environment: AppSettingsValues;
  defaultRoleOverridden: boolean;
  adminEmailsOverridden: boolean;
}

export interface UseAppSettingsResult {
  settings: AppSettingsView | undefined;
  status: UseAdminStatus;
  error: string | undefined;
  refresh: () => Promise<AppSettingsView>;
  save: (values: AppSettingsValues) => Promise<AppSettingsView>;
}

/**
 * Loads `AdminService.GetSystemStatus` on mount and re-polls every `pollMs`.
 * Like `useUsers`, this is deliberately separate from `liveStore`: the RPC
 * returns `permission_denied` for non-admins, and the metrics are point-in-
 * time snapshots rather than change-stream data, so polling is the natural
 * fit. Poll failures only flip the load status/error; the interval keeps
 * running so a transient failure recovers on the next tick.
 */
export function useSystemStatus(pollMs = 15000): UseSystemStatusResult {
  const [systemStatus, setSystemStatus] = useState<SystemStatusView | undefined>(undefined);
  const [status, setStatus] = useState<UseAdminStatus>('loading');
  const [error, setError] = useState<string | undefined>(undefined);
  const [lastUpdatedAtMillis, setLastUpdatedAtMillis] = useState<number | undefined>(undefined);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await adminClient.getSystemStatus({});
      const proto = response.status;
      if (!proto || !proto.entities || !proto.changeLog) {
        throw new Error('GetSystemStatus: server returned an incomplete status');
      }
      setSystemStatus({
        serverStartedAtMillis: Number(proto.serverStartedAtMillis),
        serverTimeMillis: Number(proto.serverTimeMillis),
        version: proto.version,
        dbPath: proto.dbPath,
        dbSizeBytes: Number(proto.dbSizeBytes),
        devUserMode: proto.devUserMode,
        activeWatchSubscriptions: Number(proto.activeWatchSubscriptions),
        entities: {
          users: Number(proto.entities.users),
          employees: Number(proto.entities.employees),
          customers: Number(proto.entities.customers),
          projects: Number(proto.entities.projects),
          planVersions: Number(proto.entities.planVersions),
          assignments: Number(proto.entities.assignments),
          absences: Number(proto.entities.absences),
          quarterData: Number(proto.entities.quarterData),
          strategicGoals: Number(proto.entities.strategicGoals),
          northStarMetrics: Number(proto.entities.northStarMetrics),
          oneOnOneSessions: Number(proto.entities.oneOnOneSessions),
          publicHolidays: Number(proto.entities.publicHolidays),
        },
        changeLog: {
          rows: Number(proto.changeLog.rows),
          oldestSeq: Number(proto.changeLog.oldestSeq),
          newestSeq: Number(proto.changeLog.newestSeq),
          retentionRows: Number(proto.changeLog.retentionRows),
        },
      });
      setLastUpdatedAtMillis(Date.now());
      setStatus('ready');
      setError(undefined);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, []);

  useEffect(() => {
    // refresh() already records the failure in status/error above, so the
    // rejection only needs swallowing here to keep the poll loop alive.
    void refresh().catch(() => {});
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  return { systemStatus, status, error, lastUpdatedAtMillis, refresh };
}

/**
 * Owns the `GetAppSettings`/`UpdateAppSettings` state for the setup form.
 * Failures of `save` are left as rejected promises for the caller
 * (`ApplicationSetup`) to turn into a toast; this hook only tracks the
 * *load* status/error itself - same split as `useUsers`.
 */
export function useAppSettings(): UseAppSettingsResult {
  const [settings, setSettings] = useState<AppSettingsView | undefined>(undefined);
  const [status, setStatus] = useState<UseAdminStatus>('loading');
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(async (): Promise<AppSettingsView> => {
    try {
      const response = await adminClient.getAppSettings({});
      const { effective, environment } = response;
      if (!effective || !environment) {
        throw new Error('GetAppSettings: server returned an incomplete response');
      }
      // Reuses the shared role table rather than a second convention: a proto
      // value with no domain mapping fails loud here, exactly like adapters.ts.
      const defaultRole = userRoleMapping.toTs.get(effective.defaultRole);
      const environmentDefaultRole = userRoleMapping.toTs.get(environment.defaultRole);
      if (!defaultRole || !environmentDefaultRole) {
        throw new Error('GetAppSettings: server returned an unmapped default_role');
      }
      const view: AppSettingsView = {
        defaultRole,
        adminEmails: effective.adminEmails,
        environment: {
          defaultRole: environmentDefaultRole,
          adminEmails: environment.adminEmails,
        },
        defaultRoleOverridden: response.defaultRoleOverridden,
        adminEmailsOverridden: response.adminEmailsOverridden,
      };
      setSettings(view);
      setStatus('ready');
      setError(undefined);
      return view;
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, []);

  useEffect(() => {
    void load().catch(() => {
      // load() already recorded the error status/message above.
    });
  }, [load]);

  const save = useCallback(
    async (values: AppSettingsValues): Promise<AppSettingsView> => {
      const defaultRole = userRoleMapping.toProto.get(values.defaultRole);
      if (defaultRole === undefined) {
        throw new Error(`UpdateAppSettings: unmapped default role "${values.defaultRole}"`);
      }
      await adminClient.updateAppSettings({
        settings: { defaultRole, adminEmails: values.adminEmails },
      });
      // The update response carries only `effective` - refetch so the
      // environment comparison and override flags stay consistent.
      return load();
    },
    [load]
  );

  return { settings, status, error, refresh: load, save };
}
