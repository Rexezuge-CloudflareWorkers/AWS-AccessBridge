'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isUnauthorized } from '../lib/api';
import { toErrorMessage } from '../lib/errors';
import { useRequestGuard } from './useRequestGuard';

interface UseResourceOptions<T> {
  /**
   * Shown when the failure carries no message of its own. Already translated.
   * Read at failure time, so a language change does not refetch.
   */
  errorFallback: string;
  /**
   * Reload the page on a 401 instead of surfacing an error — the session expired,
   * and the reload is what sends the user through the Zero Trust login.
   */
  reloadOnUnauthorized?: boolean;
  /**
   * Called with the data of every *current* response, never a stale one. For
   * state the response also seeds that the caller owns itself.
   */
  onSuccess?: (data: T) => void;
  /**
   * Called with the display message of every current failure.
   */
  onError?: (message: string, error: unknown) => void;
}

interface UseResourceResult<T> {
  /**
   * The latest settled response. Kept while a newer request is in flight and
   * after a failed one, so a search box or pager does not blank the list on every
   * keystroke; `undefined` before the first response and whenever the fetcher is
   * `null`.
   */
  data: T | undefined;
  /**
   * The latest settled failure, cleared by the next success.
   */
  error: string | null;
  /**
   * No response has settled yet. The *initial* load only: a refetch leaves it
   * `false`, which is what lets a list stay on screen while it refreshes.
   */
  isLoading: boolean;
  /**
   * A request for the current fetcher is in flight — the initial load and every
   * refetch.
   */
  isFetching: boolean;
  /**
   * Fetches again with the same fetcher. Resolves once that request has settled
   * (or been superseded), and never rejects: a failure is reported through
   * `error` / `onError`, as it is for an automatic fetch. With a `null` fetcher
   * it resolves at once.
   */
  refresh: () => Promise<void>;
}

interface Settled<T> {
  fetcher: () => Promise<T>;
  data: T | undefined;
  error: string | null;
}

/**
 * Fetch → guard → loading → error → refresh, in one hook.
 *
 * The same ~25 lines — a `useRequestGuard`, three `useState`s, a mount effect
 * with `.then` / `.catch` checking `isCurrent` before every `setState`, and an
 * `isUnauthorized` reload — were copied into `useResources`, `useTeams`,
 * `AccountList`, `AuditLogsTab` and `CostDashboard`, each with its own small
 * variations. The request-ordering rule itself is `lib/requestGuard`; this hook
 * owns only the wiring.
 *
 * **The fetcher's identity is the dependency.** Wrap it in `useCallback` (or
 * `useMemo`) over the inputs it reads, so a new query is a new fetcher and the
 * effect refetches; a fetcher recreated every render would refetch forever.
 * `null` means "nothing to fetch": the data clears, anything in flight is
 * retired, and `isLoading` is `false`.
 *
 * Loading and error are *derived* from which fetcher the settled response
 * belongs to rather than set from the effect body, so no `setState` runs
 * synchronously in an effect and a stale response cannot clear a newer request's
 * flag. `refresh()` is an event-handler path and starts its request directly, so
 * awaiting it does not depend on a render having happened.
 */
function useResource<T>(fetcher: (() => Promise<T>) | null, options: UseResourceOptions<T>): UseResourceResult<T> {
  const guard = useRequestGuard();
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  // The fetcher a manual refresh is in flight for. Compared against the current
  // fetcher rather than a boolean, so a refresh abandoned by a selection change
  // cannot leave a spinner on whatever is selected next.
  const [refreshingFor, setRefreshingFor] = useState<(() => Promise<T>) | null>(null);
  const optionsRef = useRef(options);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    optionsRef.current = options;
    fetcherRef.current = fetcher;
  }, [options, fetcher]);

  // Leaving the fetcher `null` drops the old response in the same render, so
  // re-selecting later cannot flash the previous selection's data. This is
  // React's documented "adjust state during render" pattern, not an effect.
  if (fetcher === null && settled !== null) {
    setSettled(null);
  }

  const load = useCallback(
    (source: () => Promise<T>): Promise<void> => {
      const request = guard.begin();
      // `new Promise` rather than `source().then`: a fetcher that throws before
      // returning a promise is reported like a rejection instead of escaping.
      // (`Promise.try` is the same thing, but it is ES2025 and this app targets
      // ES2022.)
      return new Promise<T>((resolve, reject) => {
        try {
          resolve(source());
        } catch (error: unknown) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })
        .then((data: T) => {
          if (!guard.isCurrent(request)) return;
          setSettled({ fetcher: source, data, error: null });
          setRefreshingFor(null);
          optionsRef.current.onSuccess?.(data);
        })
        .catch((error: unknown) => {
          if (!guard.isCurrent(request)) return;
          setRefreshingFor(null);
          if (optionsRef.current.reloadOnUnauthorized && isUnauthorized(error)) {
            globalThis.location.reload();
            return;
          }
          const message = toErrorMessage(error, optionsRef.current.errorFallback);
          // The last good response stays: a failed refetch is not "there is
          // nothing here", and blanking a list because a poll failed would read
          // as exactly that.
          setSettled((previous) => ({ fetcher: source, data: previous?.data, error: message }));
          optionsRef.current.onError?.(message, error);
        });
    },
    [guard],
  );

  useEffect(() => {
    if (fetcher === null) {
      guard.invalidate();
      return;
    }
    void load(fetcher);
  }, [fetcher, guard, load]);

  const refresh = useCallback((): Promise<void> => {
    const source = fetcherRef.current;
    if (source === null) {
      return Promise.resolve();
    }
    setRefreshingFor(() => source);
    return load(source);
  }, [load]);

  return {
    data: fetcher === null ? undefined : settled?.data,
    error: fetcher === null ? null : (settled?.error ?? null),
    isLoading: fetcher !== null && settled === null,
    isFetching: fetcher !== null && (settled?.fetcher !== fetcher || refreshingFor === fetcher),
    refresh,
  };
}

export { useResource };
export type { UseResourceOptions, UseResourceResult };
