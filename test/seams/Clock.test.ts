import { describe, it, expect } from 'vitest';
import { SystemClock, FixedClock } from '@aws-access-bridge/shared/utils/Clock';
import { TimestampUtil } from '@aws-access-bridge/shared/utils/TimestampUtil';

describe('SystemClock', () => {
  it('reports the real current time', () => {
    const before: number = Date.now();
    const now: number = new SystemClock().now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe('FixedClock', () => {
  it('always reports the fixed time', () => {
    const clock = new FixedClock(1_704_067_200_000);
    expect(clock.now()).toBe(1_704_067_200_000);
    expect(clock.now()).toBe(1_704_067_200_000);
  });
});

/**
 * `TimestampUtil`'s current-time reads now go through the `Clock`, which is what
 * makes the seam real: `SystemClock` is the production implementation and
 * `FixedClock` lets a caller state which instant it is reasoning about.
 *
 * Previously `Clock` existed with no production consumer at all — one test file
 * asserted a class nothing injected — while `TimestampUtil` read `Date.now()`
 * behind a static method no test could control.
 */
describe('TimestampUtil current-time reads honour an injected clock', () => {
  const instant = 1_704_067_200_000;

  it('defaults to the system clock', () => {
    const before: number = Date.now();
    const ms = TimestampUtil.getCurrentUnixTimestampInMilliseconds();
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(TimestampUtil.getCurrentUnixTimestampInSeconds()).toBe(Math.floor(ms / 1000));
  });

  it('pins milliseconds exactly', () => {
    expect(TimestampUtil.getCurrentUnixTimestampInMilliseconds(new FixedClock(instant))).toBe(instant);
  });

  it('pins seconds by flooring', () => {
    // Flooring is the behaviour under test: a sub-second remainder must not leak
    // into a value callers compare against a whole-second column.
    expect(TimestampUtil.getCurrentUnixTimestampInSeconds(new FixedClock(instant))).toBe(Math.floor(instant / 1000));
    expect(TimestampUtil.getCurrentUnixTimestampInSeconds(new FixedClock(1_704_067_200_999))).toBe(1_704_067_200);
  });

  it('gives the same answer for every read, which is the point', () => {
    const clock = new FixedClock(instant);
    expect(TimestampUtil.getCurrentUnixTimestampInSeconds(clock)).toBe(TimestampUtil.getCurrentUnixTimestampInSeconds(clock));
  });

  it('handles the epoch without special-casing it', () => {
    expect(TimestampUtil.getCurrentUnixTimestampInMilliseconds(new FixedClock(0))).toBe(0);
    expect(TimestampUtil.getCurrentUnixTimestampInSeconds(new FixedClock(0))).toBe(0);
  });
});

describe('TimestampUtil arithmetic is clock-independent', () => {
  it('offsets from a supplied timestamp rather than from now', () => {
    const base = 1000;
    expect(TimestampUtil.addDays(base, 1)).toBe(1000 + 86_400);
    expect(TimestampUtil.subtractMinutes(base, 2)).toBe(880);
  });

  it('parses an ISO instant to whole seconds', () => {
    expect(TimestampUtil.convertIsoToUnixTimestampInSeconds('2025-01-01T00:00:00.000Z')).toBe(1_735_689_600);
    expect(TimestampUtil.convertIsoToUnixTimestampInSeconds('2025-01-01T00:00:00.999Z')).toBe(1_735_689_600);
  });
});
