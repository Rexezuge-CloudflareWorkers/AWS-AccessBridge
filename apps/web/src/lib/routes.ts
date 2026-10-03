'use client';

/**
 * Pathname → view mapping, extracted from `useRouter` so it is testable.
 *
 * `parseRoute` used to read `globalThis.location` itself, which made it untestable
 * in the node environment — a routing function whose whole job is mapping strings
 * to views, exercised only through a DOM. The pure half takes a pathname; the
 * hook keeps the one-line read of `location`.
 */
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

/**
 * Every spelling the admin area answers to, longest-prefix first.
 *
 * Three prefixes exist for one route: `/admin` (legacy), `/user/admin` (the
 * canonical directory, which the Worker serves), and `/user/app/admin` (the page
 * path). Checking `path === X` alone would miss `/admin/credentials`, so each is
 * matched as an exact path *or* a prefix followed by a separator — a bare
 * `startsWith` would wrongly capture `/administrator`.
 */
const ADMIN_PREFIXES = ['/admin', '/user/admin', '/user/app/admin'];

const isAdminPath = (path: string): boolean =>
  ADMIN_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

/**
 * Maps a pathname to a view, and to an admin sub-tab when the path is under the
 * admin area.
 *
 * An unknown path falls back to `accounts` rather than 404ing: the Worker already
 * serves the SPA shell for any `/user/app/*` path, and a hard failure here would
 * strand a user on a bookmarked deep link.
 */
function routeForPathname(pathname: string): { view: View; adminTab?: string } {
  const path: string = pathname.replace(/\/$/, '') || '/';
  if (isAdminPath(path)) {
    const parts: string[] = path.split('/').filter(Boolean);
    const adminIndex: number = parts.indexOf('admin');
    return adminIndex === -1 ? { view: 'admin' } : { view: 'admin', adminTab: parts[adminIndex + 1] };
  }
  return { view: PATH_TO_VIEW[path] ?? 'accounts' };
}

/**
 * The path `navigateTo` should push for a view/tab pair — the inverse of
 * `routeForPathname`, and what makes a refresh land back on the same view.
 */
function pathForView(view: View, tab?: string): string {
  return view === 'admin' && tab ? `/user/app/admin/${tab}` : VIEW_TO_PATH[view];
}

export type { View };
export { PATH_TO_VIEW, VIEW_TO_PATH, isAdminPath, pathForView, routeForPathname };