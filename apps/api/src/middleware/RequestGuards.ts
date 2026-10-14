import { CSRF_ERROR_CROSS_SITE_FETCH, CSRF_ERROR_UNSUPPORTED_CONTENT_TYPE } from '@aws-access-bridge/shared/constants';
import { RateLimitedError } from '@rexezuge/errors';
import { clientIp, securityHeaders, sensitivePaths } from '@rexezuge/http';
import { Context, Next } from 'hono';
import { asHeaderContext } from './kitContext';

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
 * budget without holding any connection.
 *
 * Keyed on `CF-Connecting-IP` because it is the only client IP header the platform
 * guarantees a caller cannot set — `X-Forwarded-For` and friends would let a
 * caller rotate buckets by rewriting one header. The trade-off that buys is real
 * and worth stating: Cloudflare's own guidance says IP keys are "not recommended"
 * because a corporate NAT or a mobile carrier puts many users behind one address,
 * so 120/min is a shared ceiling for such an egress rather than a per-user one.
 * The counters are also per Cloudflare location, so the effective global ceiling
 * is roughly `limit × colos` — this bounds one attacker's spend from one colo,
 * which is the goal, not a global quota.
 *
 * A deployment without the binding is intentionally fail-open: local development
 * and the free tier's default template carry no `ratelimits` block, and silently
 * 429ing every request because a binding is absent would be an availability bug in
 * its own right. The binding is declared in `wrangler.template.jsonc` and in
 * `packages/backend-runtime/src/env.d.ts`, so `env.AUTH_RATE_LIMITER` is typed —
 * no cast, and a rename is a compile error rather than a runtime `undefined`.
 */
async function rateLimitHandler(c: PlainContext, next: Next): Promise<Response | void> {
  const limiter: RateLimit | undefined = c.env.AUTH_RATE_LIMITER;
  if (!limiter) {
    await next();
    return;
  }
  // `clientIp` is the kit's one-header read, adopted so the "which header is the
  // client address" decision lives in one place in the family rather than in
  // every repo's limiter.
  const key: string = clientIp((name) => c.req.header(name));
  const { success }: { success: boolean } = await limiter.limit({ key });
  if (!success) {
    return c.json({ Exception: { Type: 'RateLimited', Message: new RateLimitedError().message } }, 429);
  }
  await next();
}

/**
 * Mark every response uncacheable, and apply the baseline security headers.
 *
 * Registered FIRST on both surfaces, wrapping the rest of the chain. It awaits
 * `next()` and then sets the header, so it must sit outside any handler that can
 * return without calling `next()` — an authentication failure returns its JSON
 * directly, and a middleware registered after it would never run on that path.
 *
 * `/user/*` and `/api/*` answers carry AWS `SecretAccessKey`/`SessionToken`, a
 * 15-minute pre-authenticated console URL, and account and audit data — none of
 * which should survive in a shared cache or the browser's back/forward cache.
 *
 * The baseline headers are `@rexezuge/http`'s `securityHeaders`, which this
 * repository had none of. The content-security policy is what stops a value
 * reflected into an error message from becoming script: every JSON envelope here
 * embeds a message the caller partly controls (an ARN echoed back in a 400, a
 * locale tag in a 422), so without a CSP a rendering mistake in one of them is a
 * stored-XSS primitive.
 *
 * `sensitivePaths` names the two surfaces that carry credentials, and the kit
 * takes that predicate as a **required** argument rather than defaulting it —
 * a list nobody thought about should not silently mean "nothing is private".
 */
async function noStoreHandler(c: PlainContext, next: Next): Promise<void> {
  await next();
  // The kit's **middleware** form rather than `applySecurityHeaders` directly,
  // because it wraps the header pass in its own try/catch and headers must never
  // fail a request. `c.res` is only materialised once a handler has produced a
  // response, so a chain where the route returns without calling `next()` leaves
  // it undefined — and a security header that throws on the way to setting one
  // would take the response down with it.
  await securityHeaders(sensitivePaths('/api', '/user'))(asHeaderContext(c), async () => {});
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
 *
 * "Carrying a body" is answered conservatively: only an explicit
 * `Content-Length: 0` counts as body-less, and a request carrying neither
 * `Content-Length` nor `Transfer-Encoding` has an *unknown* body rather than an
 * empty one — so it must declare JSON too. A browser always frames a form post,
 * so the frameless case is not reachable from the CSRF threat model; treating it
 * as "has a body" means the guard never depends on a header an attacker
 * influences. `apiRequest` sends `Content-Type: application/json` on every
 * mutating call including the body-less ones, so this costs the SPA nothing.
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
  const contentLength: string | undefined = c.req.header('Content-Length');
  // Only an explicit `Content-Length: 0` is a body-less write. Everything else —
  // including a request carrying neither framing header, whose body size is
  // simply unknown — has to declare JSON.
  const hasBody: boolean = contentLength === undefined || contentLength.trim() !== '0';
  if (hasBody) {
    const contentType: string | undefined = c.req.header('Content-Type');
    if (contentType === undefined || !contentType.trim().toLowerCase().startsWith('application/json')) {
      return c.json({ Exception: { Type: 'Forbidden', Message: CSRF_ERROR_UNSUPPORTED_CONTENT_TYPE } }, 403);
    }
  }
  await next();
}

export { csrfProtectionHandler, noStoreHandler, rateLimitHandler };
