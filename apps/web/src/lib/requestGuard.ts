'use client';

/**
 * Monotonic request-id bookkeeping for effects that can issue overlapping
 * requests. Pure and framework-free so it can be tested directly.
 *
 * A search box, a filter, and pagination each retrigger the same fetch, and the
 * responses are not guaranteed to arrive in order. Without a guard the slower
 * *earlier* request resolves last and overwrites newer state — page 1's rows
 * render under a page-2 selection, or an account's members repopulate after the
 * user has switched teams.
 *
 * This is a factory rather than a hook so the ordering rule is testable without
 * a React renderer: `useRequestGuard` holds one of these in a ref and does
 * nothing else. Keeping the rule here (instead of inside the hook) is also why
 * `AccountList` and `AuditLogsTab` could adopt it — a fourth and fifth
 * hand-rolled copy of the same three lines is how the guard came to be missing
 * from those two in the first place.
 */
interface RequestGuard {
  /** Starts a new request and returns its id. */
  begin: () => number;
  /** Whether `id` is still the newest request. */
  isCurrent: (id: number) => boolean;
  /** Retires every in-flight request without starting a new one. */
  invalidate: () => void;
  /** The current id, exposed for tests and diagnostics. */
  current: () => number;
}

function createRequestGuard(): RequestGuard {
  let latest = 0;
  return {
    begin: () => ++latest,
    isCurrent: (id: number) => id === latest,
    invalidate: () => {
      latest += 1;
    },
    current: () => latest,
  };
}

export type { RequestGuard };
export { createRequestGuard };