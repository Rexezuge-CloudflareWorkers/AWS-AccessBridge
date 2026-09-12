'use client';

import { useState, useEffect } from 'react';
import { applyLanguage } from '../lib/locale';
import { loadCurrentUser } from '../services/authService';

export interface AuthState {
  isAuthorized: boolean | null;
  isSuperAdmin: boolean;
  isDemoMode: boolean;
  userEmail: string;
}

export function useAuth(): AuthState {
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [userEmail, setUserEmail] = useState('');

  useEffect(() => {
    loadCurrentUser()
      .then((userData) => {
        setIsAuthorized(true);
        setIsSuperAdmin(userData.isSuperAdmin || false);
        setIsDemoMode(userData.demoMode || false);
        setUserEmail(userData.email || '');
        if (userData.preferredLanguage) {
          void applyLanguage(userData.preferredLanguage).catch(() => undefined);
        }
      })
      .catch(() => {
        setIsAuthorized(false);
      });
  }, []);

  return { isAuthorized, isSuperAdmin, isDemoMode, userEmail };
}
