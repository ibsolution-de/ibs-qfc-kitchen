

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { User, UserRole } from '../types';
import { sessionClient } from '../api/clients';
import { userFromProto } from '../api/adapters';
import { useLanguage } from './LanguageContext';
import { AsciiSpinner } from '../components/ui/AsciiSpinner';

interface AuthContextType {
  user: User;
  /** Set-intersection: true if the user holds ANY of the given role(s). */
  isRole: (role: UserRole | UserRole[]) => boolean;
  /**
   * Dev-only: toggles `role` in/out of a local override set that `isRole`
   * reports instead of the real session roles, to preview role combinations
   * without a second account. Purely client-side - it never changes the
   * authenticated identity. Starts from the real session roles on first
   * toggle. See `clearDevRoleOverride` to reset without a page reload.
   */
  toggleDevRole: (role: UserRole) => void;
  /** Dev-only: reverts `isRole` to the real session roles. */
  clearDevRoleOverride: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useLanguage();
  const [user, setUser] = useState<User | null>(null);
  const [devRoleOverride, setDevRoleOverride] = useState<UserRole[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    sessionClient
      .getSession({})
      .then(response => {
        if (cancelled) return;
        if (!response.user) {
          throw new Error('GetSession: server returned no user');
        }
        setUser(userFromProto(response.user));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Dev-only role switch: identity/roles come from the server (proxy
  // headers), so this can never talk to the backend - it only swaps what
  // `isRole` reports locally, for previewing role combinations during
  // development. Starts from the real session roles the first time it is
  // toggled, so unchecking one role leaves the rest intact.
  const toggleDevRole = useCallback(
    (role: UserRole) => {
      setDevRoleOverride(prev => {
        const base = prev ?? user?.roles ?? [];
        return base.includes(role) ? base.filter(r => r !== role) : [...base, role];
      });
    },
    [user]
  );

  const clearDevRoleOverride = useCallback(() => {
    setDevRoleOverride(null);
  }, []);

  const isRole = useCallback(
    (role: UserRole | UserRole[]) => {
      const effectiveRoles = devRoleOverride ?? user?.roles ?? [];
      const wanted = Array.isArray(role) ? role : [role];
      return wanted.some(r => effectiveRoles.includes(r));
    },
    [devRoleOverride, user]
  );

  if (error) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-charcoal-50 text-charcoal-600 gap-2">
        <span className="text-sm font-medium">{t('common.loadError')}</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-charcoal-50 text-charcoal-600">
        <AsciiSpinner className="text-2xl mb-2" />
        <span className="text-sm font-medium">{t('common.loading')}</span>
      </div>
    );
  }

  const effectiveUser = devRoleOverride !== null ? { ...user, roles: devRoleOverride } : user;

  return (
    <AuthContext.Provider value={{ user: effectiveUser, isRole, toggleDevRole, clearDevRoleOverride }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
