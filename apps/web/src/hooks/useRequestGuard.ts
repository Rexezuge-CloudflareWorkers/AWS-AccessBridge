'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createRequestGuard, type RequestGuard } from '../lib/requestGuard';

/**
 * Monotonic request-id guard for effects that can issue overlapping requests.
 *
 * Usage — `begin()` marks a new request and `isCurrent()` is false for any
 * earlier one. Check it before *every* `setState`, including the loading flag: a
 * stale request that clears a newer request's spinner shows a table as loaded
 * while it is still empty.
 *
 * ```ts
 * const { begin, isCurrent } = useRequestGuard();
 * useEffect(() => {
 *   const request = begin();
 *   fetchThing()
 *     .then((data) => {
 *       if (!isCurrent(request)) return;
 *       setData(data);
 *     })
 *     .catch((err) => {
 *       if (!isCurrent(request)) return;
 *       setError(err);
 *     });
 * }, [deps]);
 * ```
 *
 * `invalidate()` retires every in-flight request without starting a new one —
 * the selection-cleared case, where the point is only that nothing already in
 * flight may write state afterwards. The unmount case needs no explicit call:
 * the effect below bumps the guard on teardown so a promise that resolves after
 * the component is gone is treated as stale and cannot call `setState` on it.
 *
 * The ordering rule itself lives in `lib/requestGuard.ts`, framework-free, so it
 * is unit-testable without a renderer; this hook only owns the ref.
 */
function useRequestGuard(): RequestGuard {
  const guard = useRef<RequestGuard | null>(null);
  if (guard.current === null) {
    guard.current = createRequestGuard();
  }

  useEffect(() => () => guard.current?.invalidate(), []);

  // Stable across renders: the guard is state, and returning a fresh object each
  // render would make every consumer's effect deps churn on every render.
  return useMemo(() => guard.current as RequestGuard, []);
}

export type { RequestGuard };
export { useRequestGuard };