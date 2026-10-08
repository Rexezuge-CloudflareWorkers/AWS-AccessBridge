import { toErrorMessage } from './errors';

/**
 * The outcome of {@link runAction}: a value, or the failure and its display text.
 *
 * A discriminated union rather than `T | undefined`, because an action that
 * resolves `undefined` on success (most writes) would be indistinguishable from
 * one that failed.
 */
type ActionResult<T> = { ok: true; value: T } | { ok: false; error: unknown; message: string };

/**
 * Runs `action`, converting a rejection — or a synchronous throw — into an
 * {@link ActionResult} instead of letting it propagate.
 *
 * Pure and framework-free so the try/catch shape that `useAsyncAction` wraps with
 * busy-state is testable without a renderer.
 */
async function runAction<T>(action: () => Promise<T>, errorFallback: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, error, message: toErrorMessage(error, errorFallback) };
  }
}

/**
 * Wraps a mutation so `after` runs once it has succeeded — the
 * "write, then re-read" shape every team mutation had spelled out by hand.
 *
 * A rejected `action` rejects the returned function and `after` never runs: a
 * refresh after a failed write would only re-render state the write did not
 * change. The action's own result is returned, not `after`'s.
 */
function afterSuccess<A extends unknown[], R>(
  action: (...args: A) => Promise<R>,
  after: (...args: A) => Promise<void>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    const result = await action(...args);
    await after(...args);
    return result;
  };
}

export type { ActionResult };
export { afterSuccess, runAction };
