/**
 * Money rounding and Cost Explorer lookback windows.
 *
 * Both were open-coded at five and four call sites respectively, each spelling
 * the arithmetic out again. `Math.round(x * 100) / 100` on a float is not
 * exactly two-decimal rounding, but it is what every caller did, so it is what
 * lives here — changing it would move money totals everywhere at once, which is
 * a decision to make deliberately rather than by accident.
 */
const MoneyUtil = {
  /**
  Two-decimal rounding, matching the `USD` amounts Cost Explorer reports.
  */
  round(amount: number): number {
    return Math.round(amount * 100) / 100;
  },

  /**
  An ISO `YYYY-MM-DD` day string, which is the format the CE API takes.
  */
  toIsoDay(unixSeconds: number): string {
    return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
  },

  /**
   * The `[startDate, endDate]` window Cost Explorer is queried for.
   *
   * `days` is a day count, not a month count: `getTrends` passes
   * `months * COST_TREND_DAYS_PER_MONTH` because Cost Explorer's granularity
   * cannot express a calendar month directly.
   */
  lookbackWindow(days: number): { startDate: string; endDate: string } {
    const now: number = Math.floor(Date.now() / 1000);
    return {
      startDate: MoneyUtil.toIsoDay(now - days * 86_400),
      endDate: MoneyUtil.toIsoDay(now),
    };
  },
};

export { MoneyUtil };