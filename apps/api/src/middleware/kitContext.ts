import type { HeaderContext } from '@rexezuge/http';
import type { Context } from 'hono';

/**
 * The bridge between this repository's middleware and `@rexezuge/http`.
 *
 * The kit's middleware takes **structural** context types rather than Hono's
 * `Context<…>`, deliberately: that is what lets one `rateLimit` serve a
 * `Request`-dispatching surface, a chanfana route, and a test double without any
 * of them importing a web framework. The cost of that choice is exactly this file
 * — each context type is three or four lines to satisfy, and the alternative
 * (every kit consumer writing its own middleware again) is what the kit exists to
 * stop.
 *
 * So this is the *only* place either side's shape is written down. A change to
 * either context type is a compile error here rather than a silent mismatch in
 * three middlewares.
 */

/**
 * The slice of a Hono context `securityHeaders` reads.
 *
 * Both reads are defensive, and both for the same reason: this middleware runs at
 * the **outermost** point of the chain, so it executes on paths where Hono has not
 * materialised a response and on contexts assembled by a test double. `c.res` is
 * absent until a handler produces one — an authentication failure that returns its
 * own JSON never gets that far — and dereferencing it would turn a security header
 * into the thing that breaks the response, the precise inversion of what a header
 * is for.
 *
 * The degradation is also correct rather than merely safe. An absent response
 * reads as an empty header set, which the kit reads as "not HTML" and declines to
 * attach a document policy to. An absent URL makes its `new URL()` throw inside the
 * kit's own guard, which skips the per-path predicate and applies the baseline —
 * the right answer for a JSON API either way.
 */
export function asHeaderContext<E extends Record<string, unknown>>(c: Context<E>): HeaderContext {
  return {
    header: (name, value): void => {
      c.header(name, value);
    },
    res: { headers: c.res?.headers ?? new Headers() },
    req: { url: c.req?.url ?? '' },
  };
}

/**
 * The `json` callback `toErrorResponse` injects rather than importing, so it can
 * answer from a chanfana response as readily as from a Hono one.
 */
export function asJsonResponder<E extends Record<string, unknown>>(
  c: Context<E>,
): (body: unknown, status: number, headers?: Record<string, string>) => Response {
  return (body, status, headers): Response => c.json(body, status as 400, headers);
}
