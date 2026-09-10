'use client';

import { useState, useEffect } from 'react';

interface UserMe {
  isSuperAdmin?: boolean;
  email?: string;
  demoMode?: boolean;
}

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
    const checkAuth = async () => {
      try {
        const response = await fetch('/user/me');
        if (response.status === 401) {
          setIsAuthorized(false);
        } else if (response.ok) {
          const userData = (await response.json()) as UserMe;
          setIsAuthorized(true);
          setIsSuperAdmin(userData.isSuperAdmin || false);
          setIsDemoMode(userData.demoMode || false);
          setUserEmail(userData.email || '');
        } else {
          setIsAuthorized(false);
        }
      } catch {
        setIsAuthorized(false);
      }
    };
    checkAuth();
  }, []);

  return { isAuthorized, isSuperAdmin, isDemoMode, userEmail };
}
