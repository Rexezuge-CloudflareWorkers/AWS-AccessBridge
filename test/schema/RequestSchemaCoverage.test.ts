import { describe, it, expect } from 'vitest';
import { RequestInputSchemas } from '@aws-access-bridge/shared/schema';
import { AccessBridgeWorker } from '@/workers/AccessBridgeWorker';
import { getRequestInputSchema } from '@/schema';

/**
 * `RequestInputSchemas` is consulted by method + path, so an entry that names a
 * route that does not exist is dead and a route with input but no entry gets **no
 * validation at all** — the failure mode is invisible in every other check, since
 * a 400-less route still typechecks, lints, and passes the tests.
 *
 * This pins the map against the router table rather than trusting the two to
 * stay aligned by hand.
 */

/**
Concrete `METHOD /path` routes: no `ALL` middleware entries, no wildcards.
*/
function registeredRoutes(): Array<{ method: string; path: string }> {
  const app = new AccessBridgeWorker() as unknown as {
    app: { routes: Array<{ method: string; path: string }> };
  };
  return app.app.routes
    .map((route) => ({ method: route.method.toUpperCase(), path: route.path }))
    .filter((route) => /^(?:GET|POST|PUT|DELETE|PATCH)$/.test(route.method) && !route.path.includes('*'));
}

/**
 * Routes that read no validated input: the legacy page redirects, and the SPA
 * catch-all's sibling entries.
 */
const NON_ENDPOINT_ROUTES: Set<string> = new Set([
  'GET /',
  'GET /user',
  'GET /costs',
  'GET /resources',
  'GET /admin',
  // Chanfana's generated documentation routes.
  'GET /docs',
  'GET /redocs',
  'GET /openapi.json',
  'GET /openapi.yaml',
]);

/**
The key form `getRouteKey` builds: no trailing slash, upper-case method.
*/
function routeKey(method: string, path: string): string {
  const pathname: string = path.length > 1 ? path.replace(/\/$/, '') : path;
  return `${method.toUpperCase()} ${pathname}`;
}

const routes: Array<{ method: string; path: string }> = registeredRoutes();

describe('request schema coverage', () => {
  it('sees the router table', () => {
    // Guards the test itself: if the routes are not collected, every assertion
    // below passes vacuously.
    expect(routes.length).toBeGreaterThan(40);
  });

  it('every schema entry names a route that exists', () => {
    // A `Set`, not an array: the very next line calls `.has` on it, which an array does
    // not have. The annotation said `string[]` while the value was a `Set`, so the file
    // reported an error on each of the two lines rather than on the declaration that
    // was actually wrong.
    const keys: ReadonlySet<string> = new Set(routes.map((route) => routeKey(route.method, route.path)));
    const orphans: string[] = Object.keys(RequestInputSchemas).filter((key) => !keys.has(key));
    expect(orphans).toEqual([]);
  });

  it.each(Object.keys(RequestInputSchemas))('resolves %s through getRequestInputSchema', (key) => {
    const [method, path] = key.split(' ', 2);
    const request: Request = new Request(`https://worker.example.com${path}`, { method });
    expect(getRequestInputSchema(request)).toBeDefined();
  });

  /**
   * The routes with no schema entry take no input at all — no query parameters
   * read and no body fields consumed. Listed explicitly so adding input to one of
   * them without adding a schema fails here rather than shipping unvalidated.
   */
  const INPUT_FREE_ROUTES: string[] = [
    'GET /user/me',
    'GET /user/tokens',
    'GET /user/costs/summary',
    'GET /user/resources/summary',
    'GET /user/admin/teams',
    'POST /user/admin/maintenance/cleanup-orphaned',
  ];

  it.each(INPUT_FREE_ROUTES)('%s has no schema and reads no input', (key) => {
    const [method, path] = key.split(' ', 2);
    expect(Object.keys(RequestInputSchemas)).not.toContain(key);
    expect(getRequestInputSchema(new Request(`https://worker.example.com${path}`, { method }))).toBeUndefined();
  });

  it('covers every validated route with either a schema or the input-free list', () => {
    const covered: Set<string> = new Set([...Object.keys(RequestInputSchemas), ...INPUT_FREE_ROUTES, ...NON_ENDPOINT_ROUTES]);
    const uncovered: string[] = routes
      .map((route) => routeKey(route.method, route.path))
      .filter((key) => !covered.has(key));
    expect(uncovered).toEqual([]);
  });

  it('leaves only the known non-input routes uncovered', () => {
    // The legacy page redirects, and six endpoints that read no query or body
    // input. If the uncovered set ever grows past these, a real route lost its
    // validation — the failure mode this whole file exists to prevent.
    const covered: Set<string> = new Set([...Object.keys(RequestInputSchemas), ...NON_ENDPOINT_ROUTES]);
    const uncovered: string[] = routes.map((route) => routeKey(route.method, route.path)).filter((key) => !covered.has(key));
    expect(new Set(uncovered)).toEqual(
      new Set([
        'GET /user/me',
        'GET /user/tokens',
        'GET /user/costs/summary',
        'GET /user/resources/summary',
        'GET /user/admin/teams',
        'POST /user/admin/maintenance/cleanup-orphaned',
      ]),
    );
  });
});