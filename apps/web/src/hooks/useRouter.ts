'use client';

import { useCallback, useEffect, useState } from 'react';

type View = 'accounts' | 'costs' | 'resources' | 'admin';

const PATH_TO_VIEW: Record<string, View> = {
  '/': 'accounts',
  '/costs': 'costs',
  '/resources': 'resources',
};

const VIEW_TO_PATH: Record<View, string> = {
  accounts: '/',
  costs: '/costs',
  resources: '/resources',
  admin: '/admin',
};

function parseRoute(): { view: View; adminTab?: string } {
  const path: string = globalThis.location.pathname.replace(/\/$/, '') || '/';
  if (path === '/admin' || path.startsWith('/admin/')) {
    const tab: string | undefined = path.split('/', 3)[2] || undefined;
    return { view: 'admin', adminTab: tab };
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
    const path: string = view === 'admin' && tab ? `/admin/${tab}` : VIEW_TO_PATH[view];
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
