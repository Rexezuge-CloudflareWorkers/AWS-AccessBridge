/**
 * The one way the SPA turns a thrown value into text for a toast or an inline
 * error.
 *
 * Replaces ~28 hand-written `err instanceof Error ? err.message : '…'` sites. They
 * disagreed on one edge: most returned an `Error`'s empty message as-is, so a
 * blank toast appeared, while two guarded with `&& err.message`. The guarded form
 * is the right one for a user-facing string, so it is the only form now.
 *
 * `fallback` must already be translated — this is framework-free and cannot call
 * `t()` — which is also why it is a required argument rather than a default: a
 * call site that forgot it would silently show English.
 */
function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export { toErrorMessage };
