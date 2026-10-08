'use client';

import { useCallback, useMemo, useState } from 'react';
import { runAction } from '../lib/asyncAction';
import type { ActionResult } from '../lib/asyncAction';
import type { ShowMessage } from './useToast';

interface RunOptions<T> {
  /**
   * Shown when the failure carries no message of its own. **Already translated** —
   * the caller owns `t()`, so a fallback can never be a hard-coded English string
   * that the locale bundles do not know about.
   */
  errorFallback: string;
  /**
   * A success toast; a function receives the action's result (a count, an id).
   */
  successMessage?: string | ((value: T) => string);
  /**
   * Runs after the action resolves and before the success toast.
   */
  onSuccess?: (value: T) => void;
  /**
   * Runs after a failure and before the error toast, for state the failed action
   * must undo (a validation result, a spinner owned elsewhere).
   */
  onError?: (error: unknown) => void;
  /**
   * Rewrites the error toast, e.g. to append a hint to the API's own message.
   */
  formatError?: (message: string) => string;
}

interface AsyncActions {
  /**
   * The key of the action in flight, or `null`.
   */
  busyKey: string | null;
  isBusy: (key: string) => boolean;
  /**
   * Runs `action` under `key`: marks it busy, reports a failure as an error
   * toast, and always clears the busy flag. Never rejects — a failure is in the
   * returned result, not thrown — so a fire-and-forget `void run(...)` cannot
   * leave an unhandled rejection behind.
   */
  run: <T>(key: string, action: () => Promise<T>, options: RunOptions<T>) => Promise<ActionResult<T>>;
}

/**
 * Busy-key state, try/catch/finally and the error toast for a feature's
 * mutations, so a handler states only what is specific to it.
 *
 * The same ~12 lines were spelled out in every admin tab and eight onboarding
 * handlers, and the copies drifted: one of the wizard's handlers reused another's
 * busy key (so the wrong button showed a spinner) and eight carried an English
 * fallback `t()` had never seen.
 *
 * One key at a time. A finishing action clears the flag only if it still owns it,
 * so an action that finishes early cannot switch off the spinner of one started
 * after it.
 */
function useAsyncAction(showMessage: ShowMessage): AsyncActions {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const run = useCallback(
    async <T>(key: string, action: () => Promise<T>, options: RunOptions<T>): Promise<ActionResult<T>> => {
      setBusyKey(key);
      try {
        const result = await runAction(action, options.errorFallback);
        if (result.ok) {
          options.onSuccess?.(result.value);
          const message = typeof options.successMessage === 'function' ? options.successMessage(result.value) : options.successMessage;
          if (message) {
            showMessage('success', message);
          }
        } else {
          options.onError?.(result.error);
          showMessage('error', options.formatError ? options.formatError(result.message) : result.message);
        }
        return result;
      } finally {
        setBusyKey((current) => (current === key ? null : current));
      }
    },
    [showMessage],
  );

  const isBusy = useCallback((key: string): boolean => busyKey === key, [busyKey]);

  return useMemo(() => ({ busyKey, isBusy, run }), [busyKey, isBusy, run]);
}

export { useAsyncAction };
export type { AsyncActions, RunOptions };
