'use client';

import { useCallback, useEffect, useState } from 'react';
import { pathForView, routeForPathname, type View } from '../lib/routes';

/**
 * Pathname router extracted from `SpaApp.tsx` (361-line entry mixing
 * routing, auth, page state, and nav). Owns view/adminTab + history sync.
 *
 * The pathname → view mapping itself lives in `lib/routes` as pure functions, so
 * it is testable without a DOM; this hook owns only the `location` read, the
 * `history` write, and the popstate listener.
 */
function useRouter() {
  const [currentView, setCurrentView] = useState<View>(() => routeForPathname(globalThis.location.pathname).view);
  const [adminTab, setAdminTab] = useState<string | undefined>(() => routeForPathname(globalThis.location.pathname).adminTab);

  const navigateTo = useCallback((view: View, tab?: string) => {
    setCurrentView(view);
    setAdminTab(view === 'admin' ? tab : undefined);
    const path: string = pathForView(view, tab);
    if (globalThis.location.pathname !== path) {
      history.pushState(null, '', path);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const route = routeForPathname(globalThis.location.pathname);
      setCurrentView(route.view);
      setAdminTab(route.adminTab);
    };
    globalThis.addEventListener('popstate', onPopState);
    return () => globalThis.removeEventListener('popstate', onPopState);
  }, []);

  return { currentView, adminTab, navigateTo };
}

export { useRouter };
export type { View } from '../lib/routes';