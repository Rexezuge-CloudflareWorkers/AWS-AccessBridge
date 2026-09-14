'use client';

import { useState, useEffect } from 'react';
import { loadCurrentUser, type CurrentUser } from '../services/authService';

export interface AuthState {
  isAuthorized: boolean | null;
  isSuperAdmin: boolean;
  isDemoMode: boolean;
  userEmail: string;
  user: CurrentUser | null;
  setUser: (user: CurrentUser) => void;
}

export function useAuth(): AuthState {
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    loadCurrentUser()
      .then((userData) => {
        setUser(userData);
        setIsAuthorized(true);
        setIsSuperAdmin(userData.isSuperAdmin || false);
        setIsDemoMode(userData.demoMode || false);
        setUserEmail(userData.email || '');
      })
      .catch(() => {
        setIsAuthorized(false);
      });
  }, []);

  return { isAuthorized, isSuperAdmin, isDemoMode, userEmail, user, setUser };
}
