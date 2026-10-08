/**
 * Chart arithmetic for the cost dashboard, kept out of the component so the
 * scaling and ordering rules are testable.
 */

/**
 * The value a trend bar's height is measured against: the largest monthly total,
 * floored at 1.
 *
 * The floor is what makes an all-zero (or empty) series safe — `0 / 0` is `NaN`,
 * which renders as an invalid CSS height — and what keeps a series of
 * sub-dollar totals from being stretched to fill the chart.
 */
function maxTrend(trends: ReadonlyArray<{ total: number }>): number {
  return trends.reduce((max, trend) => (Number.isFinite(trend.total) && trend.total > max ? trend.total : max), 1);
}

/**
 * A bar's height as a percentage of the chart. Clamped to `[0, 100]` so a
 * negative total (a credit) cannot produce a negative height.
 */
function trendBarPercent(total: number, max: number): number {
  return !Number.isFinite(total) || max <= 0 ? 0 : Math.min(100, Math.max(0, (total / max) * 100));
}

/**
 * Accounts ordered by spend, highest first. Does not mutate its input, and keeps
 * the original order for ties.
 */
function sortAccountsByCost<T extends { totalCost: number }>(accounts: Record<string, T>): Array<[string, T]> {
  return Object.entries(accounts).sort(([, a], [, b]) => b.totalCost - a.totalCost);
}

export { maxTrend, sortAccountsByCost, trendBarPercent };
