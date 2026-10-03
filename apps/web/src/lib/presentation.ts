'use client';

/**
 * Pure presentation helpers lifted out of `.tsx` components.
 *
 * These were module-private functions inside three components, which made them
 * effectively untested: a `.tsx` needs a DOM and a renderer to exercise, so a
 * windowing function with three boundary cases and a status-colour mapping sat
 * at 0% coverage while being exactly the kind of logic that has boundary cases.
 * Being in `lib/` also puts them inside the coverage `include`, so they count.
 *
 * They return raw values rather than JSX so they stay framework-free and
 * assertable.
 */

/**
 * The page numbers to show in a pager window.
 *
 * `currentPage` is kept as close to the middle of the window as the ends allow:
 * the window starts at `currentPage - 2`, clamped so it never runs past the last
 * page and never before the first.
 *
 * The clamp is expressed against `windowSize` rather than as a fixed `totalPages - 2`
 * test. That earlier form was correct only for the default window of 5 — the
 * hardcoded 2 is really "half the window minus one" — so any other window size
 * produced page numbers past `totalPages`: at `windowSize: 10, totalPages: 11,
 * currentPage: 5` it returned `[3..12]`. Latent rather than live, because the only
 * caller uses the default, but the parameter is public and a second caller would
 * have inherited it.
 */
function pageNumbers(currentPage: number, totalPages: number, windowSize = 5): number[] {
  const count = Math.min(windowSize, totalPages);
  if (count <= 0) return [];
  const start = Math.max(1, Math.min(currentPage - Math.floor(windowSize / 2), totalPages - count + 1));
  return Array.from({ length: count }, (_, i) => start + i);
}

/**
 * Colour for a resource's lifecycle state.
 *
 * `state` is the raw AWS value, which is inconsistently cased across services —
 * EC2 uses lowercase, several others capitalise — hence both spellings in the
 * `available` arm. Anything unrecognised gets the amber default rather than
 * being assumed healthy.
 */
function resourceStateColor(state: string): string {
  return ['running', 'active', 'Active', 'available'].includes(state)
    ? '#4ade80'
    : ['stopped', 'inactive'].includes(state)
      ? '#f87171'
      : '#facc15';
}

/**
 * Colour for an HTTP status code, as used by the audit log.
 *
 * Split at 300 and 400 so 2xx reads green, 3xx amber, and everything from 4xx up
 * red — a 4xx here is a failed request regardless of who caused it.
 */
function httpStatusColor(code: number): string {
  return code < 300 ? '#4ade80' : code < 400 ? '#facc15' : '#f87171';
}

export { httpStatusColor, pageNumbers, resourceStateColor };