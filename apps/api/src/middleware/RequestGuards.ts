import { CSRF_ERROR_CROSS_SITE_FETCH, CSRF_ERROR_UNSUPPORTED_CONTENT_TYPE } from '@aws-access-bridge/shared/constants';
import { RateLimitedError } from '@aws-access-bridge/backend-errors';
import { Context, Next } from 'hono';

/**
 * The three middleware that guard a request *before* anything authenticates it.
 *
 * They are grouped here rather than in `MiddlewareHandlers` because they share no
 * state with the auth chain: each one answers from the request's own headers and
 * the env alone, none of them resolves a service from the request scope, and all
 * three answer a fixed envelope. `MiddlewareHandlers` holds what needs the scope
 * (the PAT lookup, the identity resolution, the audit write) — a line-count
 * distinction that is also a coupling one.
 */
type PlainContext = Context<{ Bindings: Env }>;

/**
 * Throttle the unauthenticated `/api/*` surface.
 *
 * Every unauthenticated hit used to cost the worker a PAT row lookup and an
 * audit write; with one lookup per request a client can DoS the D1 subrequest
 * budget without holding any connection. The platform's Rate Limiting binding
 * answers 120/min per CF-Connecting-IP from each colo. CF-Connecting-IP is the
 * only header the platform guarantees is unforgeable; X-Forwarded-For et al.
 * would let the caller rotate keys. A deployment without the binding is
 * intentionally fail-open: local development and the free tier's default
 * template carry no `ratelimits` block, and silently 429ing every request
 * because a binding is absent would be an availability bug in its own right.
 */
async function rateLimitHandler(c: PlainContext, next: Next): Promise<Response | void> {
  const limiter: RateLimit | undefined = (c.env as { AUTH_RATE_LIMITER?: RateLimit }).AUTH_RATE_LIMITER;
  if (!limiter) {
    await next();
    return;
  }
  const key: string = c.req.header('cf-connecting-ip')?.trim() || 'unknown';
  const { success }: { success: boolean } = await limiter.limit({ key });
  if (!success) {
    return c.json({ Exception: { Type: 'RateLimited', Message: new RateLimitedError().getErrorMessage() } }, 429);
  }
  await next();
}

/**
 * Mark every response uncacheable.
 *
 * Registered FIRST on both surfaces, wrapping the rest of the chain. It awaits
 * `next()` and then sets the header, so it must sit outside any handler that can
 * return without calling `next()` — an authentication failure returns its JSON
 * directly, and a middleware registered after it would never run on that path.
 *
 * `/user/*` and `/api/*` answers carry AWS `SecretAccessKey`/`SessionToken`, a
 * 15-minute pre-authenticated console URL, and account and audit data — none of
 * which should survive in a shared cache or the browser's back/forward cache.
 */
async function noStoreHandler(c: PlainContext, next: Next): Promise<void> {
  await next();
  c.header('Cache-Control', 'no-store, max-age=0');
  // Belt and braces for the redirect: a 302 whose `Location` carries a console
  // token is itself the sensitive artefact.
  c.header('Pragma', 'no-cache');
}

/**
 * Cross-site request forgery protection for the cookie-authenticated `/user/*`
 * surface.
 *
 * Two independent checks, both 403-envelope answers:
 *
 * 1. `Sec-Fetch-Site`, when the browser supplies it, must mean same-origin or
 *    none. A missing header is allowed: curl, server-to-server and older
 *    browsers simply do not send it, and blocking them would break the SPA's
 *    own same-origin calls only where a browser opts to add the header.
 * 2. A state-changing request carrying a body must declare
 *    `Content-Type: application/json`. `application/x-www-form-urlencoded`
 *    and `text/plain` are exactly the types a cross-site HTML form can send,
 *    and JSON is the one type a simple form cannot forge — parsing a
 *    non-JSON body as JSON must fail, so this also stops content-type
 *    confusion on the routes.
 */
const STATE_CHANGING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function csrfProtectionHandler(c: PlainContext, next: Next): Promise<Response | void> {
  if (!STATE_CHANGING_METHODS.has(c.req.method)) {
    await next();
    return;
  }
  const secFetchSite: string | undefined = c.req.header('Sec-Fetch-Site');
  if (secFetchSite !== undefined) {
    const normalized: string = secFetchSite.trim().toLowerCase();
    if (normalized !== 'same-origin' && normalized !== 'none') {
      return c.json({ Exception: { Type: 'Forbidden', Message: CSRF_ERROR_CROSS_SITE_FETCH } }, 403);
    }
  }
  const contentType: string | undefined = c.req.header('Content-Type');
  const contentLength: string | undefined = c.req.header('Content-Length');
  const hasBody: boolean =
    (contentLength !== undefined && contentLength.trim() !== '' && contentLength !== '0') ||
    c.req.header('Transfer-Encoding') !== undefined;
  if (hasBody && (contentType === undefined || !contentType.trim().toLowerCase().startsWith('application/json'))) {
    return c.json({ Exception: { Type: 'Forbidden', Message: CSRF_ERROR_UNSUPPORTED_CONTENT_TYPE } }, 403);
  }
  await next();
}

export { csrfProtectionHandler, noStoreHandler, rateLimitHandler };
