'use client';

import { useCallback, useEffect, useState } from 'react';

type View = 'accounts' | 'costs' | 'resources' | 'admin';

const PATH_TO_VIEW: Record<string, View> = {
  '/user': 'accounts',
  '/user/app': 'accounts',
  '/user/app/costs': 'costs',
  '/user/app/resources': 'resources',
  // Legacy root page routes (pre-/user/ canonical). The Worker redirects
  // these to /user/app/* in production; accept them here for dev/transition.
  '/': 'accounts',
  '/costs': 'costs',
  '/resources': 'resources',
};

const VIEW_TO_PATH: Record<View, string> = {
  accounts: '/user/',
  costs: '/user/app/costs',
  resources: '/user/app/resources',
  admin: '/user/app/admin',
};

function parseRoute(): { view: View; adminTab?: string } {
  const path: string = globalThis.location.pathname.replace(/\/$/, '') || '/';
  if (
    path === '/admin' ||
    path === '/user/admin' ||
    path === '/user/app/admin' ||
    path.startsWith('/admin/') ||
    path.startsWith('/user/admin/') ||
    path.startsWith('/user/app/admin/')
  ) {
    const parts: string[] = path.split('/').filter(Boolean);
    const adminIndex: number = parts.indexOf('admin');
    return adminIndex === -1 ? { view: 'admin' } : { view: 'admin', adminTab: parts[adminIndex + 1] };
  }
  return { view: PATH_TO_VIEW[path] ?? 'accounts' };
}

/**
 * Pathname router extracted from `SpaApp.tsx` (361-line entry mixing
 * routing, auth, page state, and nav). Owns view/adminTab + history sync.
 */
function useRouter() {
  const [currentView, setCurrentView] = useState<View>(() => parseRoute().view);
  const [adminTab, setAdminTab] = useState<string | undefined>(() => parseRoute().adminTab);

  const navigateTo = useCallback((view: View, tab?: string) => {
    setCurrentView(view);
    setAdminTab(view === 'admin' ? tab : undefined);
    const path: string = view === 'admin' && tab ? `/user/app/admin/${tab}` : VIEW_TO_PATH[view];
    if (globalThis.location.pathname !== path) {
      history.pushState(null, '', path);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const route = parseRoute();
      setCurrentView(route.view);
      setAdminTab(route.adminTab);
    };
    globalThis.addEventListener('popstate', onPopState);
    return () => globalThis.removeEventListener('popstate', onPopState);
  }, []);

  return { currentView, adminTab, navigateTo };
}

export { parseRoute, useRouter, VIEW_TO_PATH, PATH_TO_VIEW };
export type { View };
