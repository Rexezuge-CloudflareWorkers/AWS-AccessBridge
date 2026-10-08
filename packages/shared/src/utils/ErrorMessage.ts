/**
 * Reduce anything that can be thrown to a message string.
 *
 * `error instanceof Error ? error.message : String(error)` was written out at
 * roughly sixteen call sites; JavaScript lets any value be thrown, so every
 * catch needs the narrowing and none should spell it differently.
 */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { toErrorMessage };
