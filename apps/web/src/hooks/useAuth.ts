'use client';

import { useCurrentUser } from '@rexezuge/web';
import { apiClient } from '../lib/api';
import type { CurrentUser } from '../services/authService';

export interface AuthState {
  isAuthorized: boolean | null;
  isSuperAdmin: boolean;
  isDemoMode: boolean;
  userEmail: string;
  user: CurrentUser | null;
  loadError: string | null;
  reloadUser: () => void;
}

export function useAuth(): AuthState {
  const { user, loading, error, reload } = useCurrentUser<CurrentUser>(apiClient);
  const isAuthorized = loading ? null : error === null && user !== null;
  const loadError = error !== null && error.status !== 401 ? error.message : null;

  return {
    isAuthorized,
    isSuperAdmin: user?.isSuperAdmin ?? false,
    isDemoMode: user?.demoMode ?? false,
    userEmail: user?.email ?? '',
    user,
    loadError,
    reloadUser: reload,
  };
}
