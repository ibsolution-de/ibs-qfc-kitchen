

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
  // The proxy session is gone (an RPC failed UNAUTHENTICATED); the app
  // shows a dedicated screen with Retry/Reload instead of a broken UI.
  const [sessionExpired, setSessionExpired] = useState(false);
  // Bump to re-run the session fetch (Retry button on both error screens).
  const [retryNonce, setRetryNonce] = useState(0);

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
        setError(null);
        setSessionExpired(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // If the failure was UNAUTHENTICATED, the transport interceptor
        // also fires `qfc:unauthenticated`; the listener below then swaps
        // this generic error for the session-expired screen.
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [retryNonce]);

  // Central session-expiry signal: the transport interceptor fires this on
  // any UNAUTHENTICATED RPC, so expiry surfacing mid-session (not just at
  // boot) lands here too. Dropping the user unmounts the app behind the
  // session-expired screen.
  useEffect(() => {
    const onUnauthenticated = () => {
      setUser(null);
      setError(null);
      setSessionExpired(true);
    };
    window.addEventListener('qfc:unauthenticated', onUnauthenticated);
    return () => window.removeEventListener('qfc:unauthenticated', onUnauthenticated);
  }, []);

  const retrySession = useCallback(() => {
    setError(null);
    setSessionExpired(false);
    setRetryNonce(nonce => nonce + 1);
  }, []);

  // Dev-only role switch: identity/roles come from the server (proxy
  // headers), so this can never talk to the backend - it only swaps what
  // `isRole` reports locally, for previewing role combinations during
  // development. Starts from the real session roles the first time it is
  // toggled, so unchecking one role leaves the rest intact.
  //
  // Compile-time gated on `import.meta.env.DEV`: Vite replaces it with
  // `false` in production builds, so the override cannot exist in any
  // deployed artifact — a production user can never switch their own role,
  // server- or client-side (the backend independently rejects role changes
  // for non-admins; see `AdminService`).
  const toggleDevRole = useCallback(
    (role: UserRole) => {
      if (!import.meta.env.DEV) return;
      setDevRoleOverride(prev => {
        const base = prev ?? user?.roles ?? [];
        return base.includes(role) ? base.filter(r => r !== role) : [...base, role];
      });
    },
    [user]
  );

  const clearDevRoleOverride = useCallback(() => {
    if (!import.meta.env.DEV) return;
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

  if (sessionExpired) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-charcoal-50 text-charcoal-600 gap-3">
        <span className="text-sm font-medium">{t('common.sessionExpired')}</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={retrySession}
            className="rounded-md bg-charcoal-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-charcoal-700"
          >
            {t('common.retry')}
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-charcoal-300 px-3 py-1.5 text-sm font-medium hover:bg-charcoal-100"
          >
            {t('common.reload')}
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-charcoal-50 text-charcoal-600 gap-3">
        <span className="text-sm font-medium">{t('common.loadError')}</span>
        <button
          type="button"
          onClick={retrySession}
          className="rounded-md bg-charcoal-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-charcoal-700"
        >
          {t('common.retry')}
        </button>
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
