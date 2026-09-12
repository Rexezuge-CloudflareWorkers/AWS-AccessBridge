import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimestampUtil } from '@aws-access-bridge/shared/utils/TimestampUtil';

describe('TimestampUtil', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getCurrentUnixTimestampInMilliseconds', () => {
    it('returns current time in milliseconds', () => {
      const expected: number = new Date('2026-01-15T12:00:00Z').getTime();
      expect(TimestampUtil.getCurrentUnixTimestampInMilliseconds()).toBe(expected);
    });
  });

  describe('getCurrentUnixTimestampInSeconds', () => {
    it('returns current time in seconds', () => {
      const expected: number = Math.floor(new Date('2026-01-15T12:00:00Z').getTime() / 1000);
      expect(TimestampUtil.getCurrentUnixTimestampInSeconds()).toBe(expected);
    });
  });

  describe('addMinutes', () => {
    it('adds minutes to a timestamp', () => {
      expect(TimestampUtil.addMinutes(1000, 5)).toBe(1000 + 5 * 60);
    });

    it('adds zero minutes', () => {
      expect(TimestampUtil.addMinutes(1000, 0)).toBe(1000);
    });
  });

  describe('addDays', () => {
    it('adds days to a timestamp', () => {
      expect(TimestampUtil.addDays(1000, 1)).toBe(1000 + 86400);
    });

    it('adds multiple days', () => {
      expect(TimestampUtil.addDays(0, 7)).toBe(7 * 86400);
    });
  });

  describe('subtractMinutes', () => {
    it('subtracts minutes from a timestamp', () => {
      expect(TimestampUtil.subtractMinutes(1000, 5)).toBe(1000 - 5 * 60);
    });

    it('subtracts zero minutes', () => {
      expect(TimestampUtil.subtractMinutes(1000, 0)).toBe(1000);
    });
  });

  describe('subtractDays', () => {
    it('subtracts days from a timestamp', () => {
      expect(TimestampUtil.subtractDays(100000, 1)).toBe(100000 - 86400);
    });
  });

  describe('convertIsoToUnixTimestampInSeconds', () => {
    it('converts ISO string to unix seconds', () => {
      const isoString = '2026-01-15T12:00:00Z';
      const expected: number = Math.floor(new Date(isoString).getTime() / 1000);
      expect(TimestampUtil.convertIsoToUnixTimestampInSeconds(isoString)).toBe(expected);
    });

    it('converts ISO string with milliseconds', () => {
      const isoString = '2026-01-15T12:00:00.500Z';
      const expected: number = Math.floor(new Date(isoString).getTime() / 1000);
      expect(TimestampUtil.convertIsoToUnixTimestampInSeconds(isoString)).toBe(expected);
    });

    it('handles epoch start', () => {
      expect(TimestampUtil.convertIsoToUnixTimestampInSeconds('1970-01-01T00:00:00Z')).toBe(0);
    });
  });
});
