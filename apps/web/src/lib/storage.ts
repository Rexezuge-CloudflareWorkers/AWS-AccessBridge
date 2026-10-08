/**
 * The slice of `Storage` this module reads, so a test can pass a plain object and
 * a missing `localStorage` (SSR, a locked-down browser) is expressible as `null`.
 */
type ReadableStorage = Pick<Storage, 'getItem'>;

/**
 * Reads a whole number from storage, falling back when the entry is absent,
 * garbage, below `min` once truncated, or when storage itself throws (Safari
 * private mode does).
 *
 * `Math.trunc(Number(saved))` was the previous spelling at each call site. It
 * turned `"abc"` into `NaN`, which then flowed into `limit`/`offset` and
 * `Math.ceil(total / NaN)`, and `"-5"` into a page the API rejects. Anything
 * unusable is the fallback instead.
 */
function readStoredInt(storage: ReadableStorage | null | undefined, key: string, fallback: number, min = 1): number {
  let raw: string | null;
  try {
    raw = storage?.getItem(key) ?? null;
  } catch {
    return fallback;
  }
  if (raw === null || raw.trim() === '') {
    return fallback;
  }
  const parsed = Math.trunc(Number(raw));
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

export type { ReadableStorage };
export { readStoredInt };
