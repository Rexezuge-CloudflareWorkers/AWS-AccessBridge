/**
 * Collect every capture group of `pattern` in `input`, in document order.
 *
 * `String.prototype.matchAll` cannot be used directly because it requires the
 * `g` flag and callers here build the regex inline. Returns an empty array when
 * there are no matches, so callers can iterate unconditionally.
 */
function matchAll(input: string, pattern: RegExp): string[] {
  return Array.from(input.matchAll(pattern), (match) => match[1] ?? '');
}

export { matchAll };
