import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyAuthFailure } from '@aws-access-bridge/web/lib/authOutcome';
import { ApiError } from '@aws-access-bridge/web/lib/api';
import { loadCurrentUser } from '@aws-access-bridge/web/services/authService';

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Regression suite for the auth-gate lockout.
 *
 * `useAuth` used to treat *any* rejection from `GET /user/me` as an expired
 * session, so a 500 (or a dropped connection) rendered the `Unauthorized`
 * screen and its Zero Trust login button. That is unrecoverable in place and
 * reads to the user as "the app locked me out". Only a 401 is an expired
 * session; everything else must stay distinguishable so the UI can offer a
 * retry instead of a login prompt that cannot fix the problem.
 */
describe('classifyAuthFailure', () => {
  it('treats only a 401 as an expired session', () => {
    expect(classifyAuthFailure(new ApiError(401, 'Missing token'))).toEqual({ kind: 'expired-session' });
  });

  it('does NOT treat a 403 as an expired session', () => {
    // Authenticated but not permitted is a real answer. Re-authenticating
    // cannot grant the permission, so a login prompt here is a dead end.
    const outcome = classifyAuthFailure(new ApiError(403, 'Forbidden'));
    expect(outcome.kind).toBe('load-failed');
  });

  it.each([
    ['a 500', new ApiError(500, 'Internal server error')],
    ['a 502', new ApiError(502, 'Bad Gateway')],
    ['a 404', new ApiError(404, 'Not Found')],
  ])('keeps %s distinguishable from an expired session', (_label, error) => {
    expect(classifyAuthFailure(error).kind).toBe('load-failed');
  });

  it('surfaces the backend message as the reason', () => {
    const outcome = classifyAuthFailure(new ApiError(500, 'Database unavailable'));
    expect(outcome).toEqual({ kind: 'load-failed', reason: 'Database unavailable' });
  });

  it('falls back to a generic reason for a non-Error rejection', () => {
    // `fetch` rejects with a TypeError, but a stubbed or future transport could
    // reject with anything. The gate must still classify, never crash.
    expect(classifyAuthFailure('boom')).toEqual({ kind: 'load-failed', reason: 'Failed to load your profile.' });
    // An Error whose `message` is **empty** -- the case that must fall back rather than
    // surface a blank reason. Built by assignment rather than written as `new Error('')`
    // or `new Error()`, both of which are rejected by `unicorn/error-message`: that rule
    // is right that an empty message is usually a mistake, and here it is the subject,
    // so the intent is written out instead of suppressed. Passing a real message instead
    // produced the same expected value while no longer covering this path, which is what
    // made it look correct.
    const emptyMessage = new Error('placeholder');
    emptyMessage.message = '';
    expect(classifyAuthFailure(emptyMessage)).toEqual({ kind: 'load-failed', reason: 'Failed to load your profile.' });
  });

  it('always yields a reason on the load-failed path', () => {
    for (const thrown of [new ApiError(500, 'x'), new Error('y'), 'z', undefined]) {
      const outcome = classifyAuthFailure(thrown);
      expect(outcome.kind === 'load-failed' && outcome.reason.length > 0).toBe(true);
    }
  });
});

describe('loadCurrentUser failures drive the gate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('classifies a real 401 from the endpoint as an expired session', async () => {
    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(json({ Exception: { Message: 'Missing token' } }, 401)));
    await expect(loadCurrentUser()).rejects.toSatisfy((error: unknown) => classifyAuthFailure(error).kind === 'expired-session');
  });

  it('classifies a real 500 from the endpoint as a load failure', async () => {
    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(json({ Exception: { Message: 'boom' } }, 500)));
    await expect(loadCurrentUser()).rejects.toSatisfy((error: unknown) => classifyAuthFailure(error).kind === 'load-failed');
  });
});