/**
 * Page arithmetic shared by every paginated view.
 *
 * Pages are **1-based** here, as the `Pagination` control and the account list
 * use them. `AuditLogsTab` and `ResourceInventory` keep a 0-based `page` in state
 * and hand `Pagination` `page + 1`; that conversion stays at their call sites.
 */

/**
 * How many pages `total` items occupy. A non-positive or non-finite `pageSize`
 * yields 0 rather than `Infinity`/`NaN`, which a caller would then render as
 * "Page 1 of Infinity".
 */
function totalPages(total: number, pageSize: number): number {
  return !Number.isFinite(total) || !Number.isFinite(pageSize) || pageSize <= 0 || total <= 0 ? 0 : Math.ceil(total / pageSize);
}

/**
 * Pins `page` into `[1, pages]`. With no pages at all the answer is 1 — the first
 * page of an empty list — never 0 or a negative number.
 */
function clampPage(page: number, pages: number): number {
  const upper = Math.max(1, Math.trunc(Number.isFinite(pages) ? pages : 1));
  const wanted = Number.isFinite(page) ? Math.trunc(page) : 1;
  return Math.min(upper, Math.max(1, wanted));
}

/**
 * The 1-based, inclusive `{from, to}` item range a page shows, clamped to `total`
 * — "11–20 of 34", and "31–34 of 34" on a short last page. Empty totals give
 * `{0, 0}`.
 */
function pageRange(page: number, pageSize: number, total: number): { from: number; to: number } {
  if (total <= 0 || pageSize <= 0) {
    return { from: 0, to: 0 };
  }
  return {
    from: Math.min((page - 1) * pageSize + 1, total),
    to: Math.min(page * pageSize, total),
  };
}

export { clampPage, pageRange, totalPages };
