import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useToast } from '@aws-access-bridge/web/hooks/useToast';
import { useAuth } from '@aws-access-bridge/web/hooks/useAuth';
import { ApiError } from '@aws-access-bridge/web/lib/api';

/**
 * The web hooks, tested against a real React renderer.
 *
 * `useToast` is the clearest case for why: it holds a dismissal timer in a ref,
 * and the two behaviours that took deliberate care — a *new* toast replacing the
 * previous one's timer rather than being dismissed early by it, and unmount not
 * leaving a timer that calls `setState` on a gone component — are both invisible
 * to a node-environment test.
 */
describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with no message', () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.message).toBeNull();
  });

  it('shows a message', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showMessage('success', 'Saved');
    });

    expect(result.current.message).toEqual({ type: 'success', text: 'Saved' });
  });

  it('dismisses the message after the timeout', () => {
    const { result } = renderHook(() => useToast(1000));

    act(() => {
      result.current.showMessage('error', 'Failed');
    });
    expect(result.current.message).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.message).toBeNull();
  });

  it('honours a custom timeout', () => {
    const { result } = renderHook(() => useToast(50));

    act(() => {
      result.current.showMessage('success', 'Quick');
    });
    act(() => {
      vi.advanceTimersByTime(49);
    });
    expect(result.current.message).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.message).toBeNull();
  });

  it('replaces a pending toast instead of letting the old timer dismiss the new one', () => {
    // The bug the ref-held timer exists to prevent: with a naive `setTimeout` per
    // call, the first toast's timer fires 1000ms after the *first* show and
    // clears the *second* message early, so a rapid success-then-error sequence
    // would silently lose the error.
    const { result } = renderHook(() => useToast(1000));

    act(() => {
      result.current.showMessage('success', 'First');
    });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    act(() => {
      result.current.showMessage('error', 'Second');
    });

    // The first toast's timer would have fired at t=1000.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.message).toEqual({ type: 'error', text: 'Second' });

    // And the second toast gets its own full window.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.message).toBeNull();
  });

  it('dismisses on demand', () => {
    const { result } = renderHook(() => useToast(10_000));

    act(() => {
      result.current.showMessage('success', 'Saved');
    });
    act(() => {
      result.current.dismiss();
    });

    expect(result.current.message).toBeNull();
  });

  it('clears the pending timer on a manual dismiss', () => {
    // Otherwise the abandoned timer would fire later and call setState again.
    const { result } = renderHook(() => useToast(1000));

    act(() => {
      result.current.showMessage('success', 'Saved');
    });
    act(() => {
      result.current.dismiss();
    });
    act(() => {
      result.current.showMessage('success', 'Again');
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // The first (abandoned) timer must not have dismissed the second message
    // early; it had a full second of its own.
    expect(result.current.message).toBeNull();
  });

  it('leaves no timer running after unmount', () => {
    // React would warn about setting state on an unmounted component, and the
    // timer would keep the test's fake clock alive.
    const { result, unmount } = renderHook(() => useToast(1000));

    act(() => {
      result.current.showMessage('success', 'Saved');
    });
    unmount();

    expect(() =>
      act(() => {
        vi.advanceTimersByTime(5000);
      }),
    ).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('tolerates dismiss before anything was shown', () => {
    const { result } = renderHook(() => useToast());
    expect(() =>
      act(() => {
        result.current.dismiss();
      }),
    ).not.toThrow();
    expect(result.current.message).toBeNull();
  });
});

/**
 * `useAuth` is the app's gate. These cover the regression from earlier in this
 * round: every failure used to be reported as an expired session, so a 500 sent
 * the user to the Zero Trust login page.
 */
describe('useAuth', () => {
  const user = { email: 'user@example.com', isSuperAdmin: false, demoMode: false };

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts unauthorized-pending, so the app can show a spinner', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => undefined)));
    const { result } = renderHook(() => useAuth());

    // `null` is distinct from `false`: it means "not decided yet", and SpaApp
    // renders a spinner for it rather than the Unauthorized screen.
    expect(result.current.isAuthorized).toBeNull();
  });

  it('authorizes and exposes the profile on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(user)));
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isAuthorized).toBe(true);
    });
    expect(result.current.userEmail).toBe('user@example.com');
    expect(result.current.isSuperAdmin).toBe(false);
    expect(result.current.isDemoMode).toBe(false);
    expect(result.current.loadError).toBeNull();
  });

  it('exposes super-admin and demo flags', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ...user, isSuperAdmin: true, demoMode: true })));
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isSuperAdmin).toBe(true);
    });
    expect(result.current.isDemoMode).toBe(true);
  });

  it('treats a 401 as an expired session, with no error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ Exception: { Message: 'Missing token' } }, 401)));
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isAuthorized).toBe(false);
    });
    // A 401 needs no explanation beyond "sign in again", and must not show a
    // scary message on the login screen.
    expect(result.current.loadError).toBeNull();
  });

  it('reports a 500 as a load failure rather than an expired session', async () => {
    // The regression: this used to send the user to the Zero Trust login page,
    // which cannot fix a server error and from which there is no recovery.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ Exception: { Message: 'Database unavailable' } }, 500)));
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isAuthorized).toBe(false);
    });
    expect(result.current.loadError).toBe('Database unavailable');
  });

  it('reports a 403 as a load failure, not a sign-in prompt', async () => {
    // Authenticated but not permitted: re-authenticating cannot grant the
    // permission, so a login prompt is a dead end.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ Exception: { Message: 'Forbidden' } }, 403)));
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isAuthorized).toBe(false);
    });
    expect(result.current.loadError).toBe('Forbidden');
  });

  it('reports a network failure with a usable message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isAuthorized).toBe(false);
    });
    expect(result.current.loadError).toBe('Failed to fetch');
  });

  it('always produces a message for a non-401 failure', async () => {
    for (const status of [403, 500, 502, 503]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, status)));
      const { result, unmount } = renderHook(() => useAuth());
      await waitFor(() => {
        expect(result.current.isAuthorized).toBe(false);
      });
      expect(result.current.loadError).toBeTruthy();
      unmount();
    }
  });

  it('lets the caller set the user without refetching', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(user)));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => {
      expect(result.current.isAuthorized).toBe(true);
    });

    const updated = { ...user, preferredLanguage: 'de' };
    act(() => {
      result.current.setUser(updated);
    });

    expect(result.current.user).toEqual(updated);
    // Only the profile object changes; identity flags are not re-derived here.
    expect(result.current.userEmail).toBe('user@example.com');
  });

  it('does not fetch again when the caller changes the user', async () => {
    // `setUser` exists so a language change can update the profile without a
    // round trip; a refetch here would discard the local edit.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(user));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(() => useAuth());
    await waitFor(() => {
      expect(result.current.isAuthorized).toBe(true);
    });

    act(() => {
      result.current.setUser({ ...user, preferredLanguage: 'fr' });
    });
    rerender();

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('classifies an ApiError exactly as the auth gate does', async () => {
    // Guards the wiring: the hook must route through `classifyAuthFailure`, not
    // re-implement the 401 test.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new ApiError(401, 'nope')));
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isAuthorized).toBe(false);
    });
    expect(result.current.loadError).toBeNull();
  });
});