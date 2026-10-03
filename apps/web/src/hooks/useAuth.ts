'use client';

import { useState, useEffect } from 'react';
import { classifyAuthFailure } from '../lib/authOutcome';
import { loadCurrentUser, type CurrentUser } from '../services/authService';

export interface AuthState {
  isAuthorized: boolean | null;
  isSuperAdmin: boolean;
  isDemoMode: boolean;
  userEmail: string;
  user: CurrentUser | null;
  /**
   * Why the profile could not be loaded, when `isAuthorized` is `false` for a
   * reason other than an expired session. Null on the success path and on a
   * 401, which needs no explanation beyond "sign in again".
   */
  loadError: string | null;
  setUser: (user: CurrentUser) => void;
}

export function useAuth(): AuthState {
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadCurrentUser()
      .then((userData) => {
        setUser(userData);
        setIsAuthorized(true);
        setIsSuperAdmin(userData.isSuperAdmin || false);
        setIsDemoMode(userData.demoMode || false);
        setUserEmail(userData.email || '');
      })
      .catch((err: unknown) => {
        // Only a 401 means "the session ended" — that is the one case where the
        // `Unauthorized` screen (and its Zero Trust login button) is the right
        // answer. Treating *every* failure as an expired session sent the user to
        // the login page on a transient 500 or a dropped connection, which reads
        // as "the app locked me out" and cannot be recovered from in place.
        const outcome = classifyAuthFailure(err);
        setIsAuthorized(false);
        setLoadError(outcome.kind === 'load-failed' ? outcome.reason : null);
      });
  }, []);

  return { isAuthorized, isSuperAdmin, isDemoMode, userEmail, user, loadError, setUser };
}
