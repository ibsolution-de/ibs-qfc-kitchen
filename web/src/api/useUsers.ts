import { useCallback, useEffect, useState } from 'react';

import { adminClient } from './clients';
import { adminUserFromProto, userRolesToProto, type AdminUser } from './adapters';
import type { UserRole } from '../types';

export type UseUsersStatus = 'loading' | 'ready' | 'error';

export interface UseUsersResult {
  users: AdminUser[];
  status: UseUsersStatus;
  /** Message for the most recent load/mutation failure; cleared once things recover. */
  error: string | undefined;
  refresh: () => Promise<void>;
  saveUser: (email: string, roles: UserRole[], employeeId?: string) => Promise<AdminUser>;
  deleteUser: (email: string) => Promise<void>;
}

/**
 * Owns admin user-management state (`AdminService`). Deliberately separate
 * from `liveStore`: `liveStore` loads eagerly for every signed-in user, but
 * these RPCs return `permission_denied` for anyone who isn't an admin. Users
 * are also not on the `EventService.Watch` change stream (broadcasting them
 * would leak every email and role to every client), so there is no push -
 * every mutation here refetches the full list instead of relying on one.
 * Failures are left as rejected promises for the caller (`ManageUsers`) to
 * turn into a toast; this hook only tracks the *load* status/error itself.
 */
export function useUsers(): UseUsersResult {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [status, setStatus] = useState<UseUsersStatus>('loading');
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await adminClient.listUsers({});
      setUsers(response.users.map(adminUserFromProto));
      setStatus('ready');
      setError(undefined);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => {
      // refresh() already recorded the error status/message above.
    });
  }, [refresh]);

  const saveUser = useCallback(
    async (email: string, roles: UserRole[], employeeId?: string): Promise<AdminUser> => {
      // Server-side canonical form (see AdminService): trim + lowercase, so
      // a mixed-case address always lands on the same account row.
      const normalized = email.trim().toLowerCase();
      const response = await adminClient.upsertUser({ email: normalized, roles: userRolesToProto(roles), employeeId });
      if (!response.user) throw new Error('UpsertUser: server returned no user');
      const saved = adminUserFromProto(response.user);
      await refresh();
      return saved;
    },
    [refresh]
  );

  const deleteUser = useCallback(
    async (email: string): Promise<void> => {
      await adminClient.deleteUser({ email: email.trim().toLowerCase() });
      await refresh();
    },
    [refresh]
  );

  return { users, status, error, refresh, saveUser, deleteUser };
}
