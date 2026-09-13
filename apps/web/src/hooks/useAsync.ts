'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface AsyncState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Generic async-data hook (vertical-slice plumbing). Previously each
 * feature (`CostDashboard`, `ResourceInventory`, `TeamsTab`,
 * `AuditLogsTab`) hand-rolled `useEffect + isLoading/error/cancelled`.
 * A single promise chain with `setState` only inside `.then`/`.catch`
 * (never synchronously in the effect body), with cancellation + dedup.
 */
function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> & { reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const requestId = useRef(0);

  const reload = useCallback(() => {
    setIsLoading(true);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const current = ++requestId.current;
    loader()
      .then((result) => {
        if (cancelled || current !== requestId.current) return;
        setData(result);
        setError(null);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || current !== requestId.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load data');
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, isLoading, error, reload };
}

export { useAsync };
export type { AsyncState };
