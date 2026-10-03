'use client';

import { isUnauthorized } from './api';

/**
 * Why the app has no usable profile. The two cases look alike at the call site
 * (a rejected `GET /user/me`) but need opposite responses from the reader:
 *
 * - `expired-session`: the credentials are gone, so re-authenticating is the fix.
 * - `load-failed`: the credentials may still be perfectly valid. A 500, a 403, a
 *   dropped connection, or a proxy error page all land here.
 *
 * Collapsing the second into the first is what previously sent a user to the
 * Zero Trust login page on a transient server error — a page that cannot fix it,
 * from which there is no in-place recovery.
 */
type AuthOutcome = { kind: 'expired-session' } | { kind: 'load-failed'; reason: string };

/**
 * Classifies a `GET /user/me` failure.
 *
 * Only a 401 means "the session ended". `isUnauthorized` matches 401 alone and
 * never a 403: 403 is a real answer (authenticated, but not permitted), and
 * treating it as an expired session would send an administrator whose token is
 * fine to a login page.
 *
 * `reason` is shown to the user, so it prefers the message the API already
 * produced (`ApiError` carries the `Exception.Message` the backend raised) over
 * a generic string, and never leaks anything the caller did not already surface.
 */
function classifyAuthFailure(error: unknown): AuthOutcome {
  if (isUnauthorized(error)) {
    return { kind: 'expired-session' };
  }
  return { kind: 'load-failed', reason: error instanceof Error && error.message ? error.message : 'Failed to load your profile.' };
}

export type { AuthOutcome };
export { classifyAuthFailure };