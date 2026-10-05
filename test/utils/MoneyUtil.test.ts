import { describe, it, expect, vi, afterEach } from 'vitest';
import { MoneyUtil } from '@aws-access-bridge/shared/utils/MoneyUtil';

describe('MoneyUtil.round', () => {
  it('keeps two decimals', () => {
    /* eslint-disable-next-line sonarjs/no-floating-point-equality -- exact equality IS the
       assertion: the value under test is a *rounded* float, so `toBeCloseTo` would
       pass whether or not the rounding happened. A range assertion cannot tell
       "rounded to two decimals" from "summed and left alone" — which is the entire
       claim of a test named for `MoneyUtil.round`. */
    expect(MoneyUtil.round(2.344)).toBe(2.34);
    /* eslint-disable-next-line sonarjs/no-floating-point-equality -- as above */
    expect(MoneyUtil.round(12.567)).toBe(12.57);
    expect(MoneyUtil.round(0.999)).toBe(1);
  });

  /**
   * Not exact decimal rounding: `1.005 * 100` is `100.49999999999999` in binary
   * floating point, so this rounds to `1`. Preserved deliberately — every call
   * site did `Math.round(x * 100) / 100`, and switching to a decimal-correct
   * implementation would move every money total at once. Fix it as its own change,
   * with the affected totals in view.
   */
  it('reproduces the float artifact the previous call sites had', () => {
    /* eslint-disable-next-line sonarjs/no-floating-point-equality -- exact equality IS the assertion:
       the value is a *rounded* float, so a range check would pass whether or not the
       rounding happened, which is the whole claim of a test named for `round`. */
    expect(MoneyUtil.round(1.005)).toBe(1);
    /* eslint-disable-next-line sonarjs/no-floating-point-equality -- as above */
    expect(MoneyUtil.round(1.015)).toBe(1.01);
  });

  it('leaves an already-rounded value alone', () => {
    expect(MoneyUtil.round(10)).toBe(10);
    expect(MoneyUtil.round(1.5)).toBe(1.5);
  });

  it('handles negatives symmetrically', () => {
    /* eslint-disable-next-line sonarjs/no-floating-point-equality -- as above */
    expect(MoneyUtil.round(-2.345)).toBe(-2.35);
  });
});

describe('MoneyUtil.toIsoDay', () => {
  it('formats a unix timestamp as YYYY-MM-DD in UTC', () => {
    expect(MoneyUtil.toIsoDay(1_735_689_600)).toBe('2025-01-01');
  });

  it('accepts the millisecond epoch by converting it', () => {
    expect(MoneyUtil.toIsoDay(0)).toBe('1970-01-01');
  });
});

describe('MoneyUtil.lookbackWindow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a window ending today and starting the requested days back', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-15T12:34:56Z'));
    expect(MoneyUtil.lookbackWindow(30)).toEqual({ startDate: '2025-02-13', endDate: '2025-03-15' });
  });

  /**
   * All four call sites previously spelled this out as
   * `new Date(Date.now() - days * 86_400_000).toISOString().split('T', 1)[0]`.
   * The shared form uses whole unix seconds, so it must agree to the day.
   */
  it('spans exactly the requested number of days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-15T00:00:00Z'));
    const window = MoneyUtil.lookbackWindow(7);
    const spanDays = (Date.parse(`${window.endDate}T00:00:00Z`) - Date.parse(`${window.startDate}T00:00:00Z`)) / 86_400_000;
    expect(spanDays).toBe(7);
  });

  it('returns a single day for a zero-day lookback', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-15T12:00:00Z'));
    expect(MoneyUtil.lookbackWindow(0)).toEqual({ startDate: '2025-03-15', endDate: '2025-03-15' });
  });

  it('emits ISO day strings the Cost Explorer API accepts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-15T12:00:00Z'));
    const { startDate, endDate } = MoneyUtil.lookbackWindow(30);
    expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(startDate <= endDate).toBe(true);
  });
});