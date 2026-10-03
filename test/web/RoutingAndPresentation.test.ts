import { describe, it, expect } from 'vitest';
import { routeForPathname, pathForView, isAdminPath, PATH_TO_VIEW, VIEW_TO_PATH } from '@aws-access-bridge/web/lib/routes';
import { pageNumbers, resourceStateColor, httpStatusColor } from '@aws-access-bridge/web/lib/presentation';

/**
 * Routing and presentation helpers lifted out of `.tsx` components.
 *
 * Each of these was a module-private function inside a component, which meant a
 * DOM and a renderer to exercise — so a windowing function with three boundary
 * cases and a three-way status mapping sat untested. Moving them into `lib/`
 * puts them inside the coverage `include` as well as making them assertable.
 */
describe('routeForPathname', () => {
  it.each([
    ['/user/', 'accounts'],
    ['/user', 'accounts'],
    ['/user/app', 'accounts'],
    ['/user/app/', 'accounts'],
    ['/user/app/costs', 'costs'],
    ['/user/app/resources', 'resources'],
  ])('maps %s to %s', (pathname, view) => {
    expect(routeForPathname(pathname)).toEqual({ view });
  });

  it.each([
    ['/', 'accounts'],
    ['/costs', 'costs'],
    ['/resources', 'resources'],
  ])('accepts the legacy path %s as %s', (pathname, view) => {
    // The Worker redirects these in production; accepting them keeps dev and
    // bookmarks working during the transition.
    expect(routeForPathname(pathname)).toEqual({ view });
  });

  it.each(['/admin', '/user/admin', '/user/app/admin'])('treats the bare admin path %s as the admin view with no tab', (pathname) => {
    expect(routeForPathname(pathname)).toEqual({ view: 'admin' });
  });

  it.each(['/admin/credentials', '/user/admin/credentials', '/user/app/admin/credentials'])('extracts the sub-tab from %s', (pathname) => {
    expect(routeForPathname(pathname)).toEqual({ view: 'admin', adminTab: 'credentials' });
  });

  it('tolerates a trailing slash on an admin sub-tab', () => {
    expect(routeForPathname('/user/app/admin/teams/')).toEqual({ view: 'admin', adminTab: 'teams' });
  });

  it('ignores path segments before `admin` when locating the tab', () => {
    // The tab is the segment *after* `admin`, wherever that sits.
    expect(routeForPathname('/user/app/admin/maintenance/task-runs')).toEqual({ view: 'admin', adminTab: 'maintenance' });
  });

  it('falls back to accounts for an unknown path rather than 404ing', () => {
    // The Worker serves the SPA shell for any /user/app/* path, so hard-failing
    // here would strand a user on a bookmarked deep link.
    expect(routeForPathname('/user/app/nope')).toEqual({ view: 'accounts' });
    expect(routeForPathname('/totally/unknown')).toEqual({ view: 'accounts' });
  });

  it('does not treat a look-alike segment as the admin area', () => {
    // `/administrator` starts with `/admin` as a raw string; matching the prefix
    // without a separator boundary would wrongly route it to admin.
    expect(routeForPathname('/administrator').view).toBe('accounts');
    expect(routeForPathname('/user/administration').view).toBe('accounts');
  });

  it('never returns an undefined view', () => {
    for (const pathname of ['/', '', '/user', '/user/app/admin', '/x/y/z', '/user/app/costs']) {
      expect(routeForPathname(pathname).view).toBeDefined();
    }
  });
});

describe('isAdminPath', () => {
  it.each(['/admin', '/user/admin', '/user/app/admin', '/admin/x', '/user/app/admin/x'])('accepts %s', (pathname) => {
    expect(isAdminPath(pathname)).toBe(true);
  });

  it.each(['/user', '/user/app', '/costs', '/administrator', '/user/app/admins', ''])('rejects %s', (pathname) => {
    expect(isAdminPath(pathname)).toBe(false);
  });
});

describe('pathForView', () => {
  it('is the inverse of routeForPathname for every view', () => {
    // The property that makes a refresh land back on the same view.
    for (const view of ['accounts', 'costs', 'resources', 'admin'] as const) {
      expect(routeForPathname(pathForView(view)).view).toBe(view);
    }
  });

  it('round-trips an admin sub-tab', () => {
    expect(routeForPathname(pathForView('admin', 'credentials'))).toEqual({ view: 'admin', adminTab: 'credentials' });
  });

  it('ignores the tab for a non-admin view', () => {
    // Passing a tab to `costs` must not produce a path that parses back to admin.
    expect(pathForView('costs', 'credentials')).toBe(VIEW_TO_PATH.costs);
    expect(routeForPathname(pathForView('costs', 'credentials')).view).toBe('costs');
  });

  it('agrees with VIEW_TO_PATH for every view with no tab', () => {
    for (const [view, path] of Object.entries(VIEW_TO_PATH)) {
      expect(pathForView(view as keyof typeof VIEW_TO_PATH)).toBe(path);
    }
  });

  it('routes every PATH_TO_VIEW entry back to its own view', () => {
    for (const [path, view] of Object.entries(PATH_TO_VIEW)) {
      expect(routeForPathname(path).view).toBe(view);
    }
  });
});

/**
 * The pager window has three boundary cases, all previously untested.
 */
describe('pageNumbers', () => {
  it('shows every page when they fit in the window', () => {
    expect(pageNumbers(1, 3)).toEqual([1, 2, 3]);
    expect(pageNumbers(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('anchors at the start near the beginning', () => {
    expect(pageNumbers(1, 20)).toEqual([1, 2, 3, 4, 5]);
    expect(pageNumbers(3, 20)).toEqual([1, 2, 3, 4, 5]);
  });

  it('slides in the middle', () => {
    expect(pageNumbers(10, 20)).toEqual([8, 9, 10, 11, 12]);
  });

  it('clamps at the end so no blank pages show', () => {
    expect(pageNumbers(20, 20)).toEqual([16, 17, 18, 19, 20]);
    expect(pageNumbers(18, 20)).toEqual([16, 17, 18, 19, 20]);
  });

  it('honours a custom window size', () => {
    expect(pageNumbers(1, 20, 3)).toEqual([1, 2, 3]);
    // The current page sits in the middle of an odd-width window.
    expect(pageNumbers(10, 20, 3)).toEqual([9, 10, 11]);
    expect(pageNumbers(20, 20, 3)).toEqual([18, 19, 20]);
  });

  it('keeps a wide window inside the page range', () => {
    // Regression guard: the end-clamp used to be a fixed `totalPages - 2`, which
    // is only the right threshold for a window of 5. At 10/11/5 it returned
    // [3..12] — three pages past the end.
    expect(pageNumbers(5, 11, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // At the start the window shows `windowSize` pages, not all of them.
    expect(pageNumbers(1, 11, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('never returns a page beyond totalPages', () => {
    for (let total = 1; total <= 30; total++) {
      for (let current = 1; current <= total; current++) {
        for (const window of [1, 3, 5, 10]) {
          for (const page of pageNumbers(current, total, window)) {
            expect(page).toBeGreaterThanOrEqual(1);
            expect(page).toBeLessThanOrEqual(total);
          }
        }
      }
    }
  });

  it('never returns a duplicate page', () => {
    // A window that overlapped itself would render duplicate page buttons.
    for (let total = 1; total <= 20; total++) {
      for (let current = 1; current <= total; current++) {
        const pages = pageNumbers(current, total);
        expect(new Set(pages).size).toBe(pages.length);
      }
    }
  });

  it('handles a single page and an empty range', () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(1, 0)).toEqual([]);
  });
});

describe('resourceStateColor', () => {
  it.each(['running', 'active', 'Active', 'available'])('treats %s as healthy', (state) => {
    expect(resourceStateColor(state)).toBe('#4ade80');
  });

  it.each(['stopped', 'inactive'])('treats %s as unhealthy', (state) => {
    expect(resourceStateColor(state)).toBe('#f87171');
  });

  it('falls back to amber for an unrecognised state', () => {
    // Anything unknown must not be assumed healthy — that is the whole reason
    // for the third arm.
    expect(resourceStateColor('terminated')).toBe('#facc15');
    expect(resourceStateColor('')).toBe('#facc15');
  });

  it('is case-sensitive outside the two spellings it knows', () => {
    // AWS is inconsistent about capitalisation; `AVAILABLE` is not a state any
    // service emits, and guessing would be worse than the neutral colour.
    expect(resourceStateColor('AVAILABLE')).toBe('#facc15');
    expect(resourceStateColor('RUNNING')).toBe('#facc15');
  });
});

describe('httpStatusColor', () => {
  it.each([200, 201, 204, 299])('treats %i as success', (code) => {
    expect(httpStatusColor(code)).toBe('#4ade80');
  });

  it.each([301, 302, 304, 399])('treats %i as a redirect', (code) => {
    expect(httpStatusColor(code)).toBe('#facc15');
  });

  it.each([400, 401, 403, 404, 500, 503])('treats %i as a failure', (code) => {
    expect(httpStatusColor(code)).toBe('#f87171');
  });

  it('is monotonically pessimistic', () => {
    // No code may be reported greener than a lower one.
    const order = ['#4ade80', '#facc15', '#f87171'];
    let previous = 0;
    for (let code = 100; code <= 599; code++) {
      const rank = order.indexOf(httpStatusColor(code));
      expect(rank).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
  });
});