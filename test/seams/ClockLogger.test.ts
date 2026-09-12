import { describe, it, expect, vi } from 'vitest';
import { SystemClock, FixedClock } from '@aws-access-bridge/shared/utils/Clock';
import { ConsoleLogger, NullLogger } from '@aws-access-bridge/shared/utils/Logger';
import type { Logger } from '@aws-access-bridge/shared/utils/Logger';

describe('Clock seam', () => {
  it('SystemClock returns the current time', () => {
    const before: number = Date.now();
    const now: number = new SystemClock().now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('FixedClock always returns the fixed time', () => {
    const clock = new FixedClock(1_704_067_200_000);
    expect(clock.now()).toBe(1_704_067_200_000);
    expect(clock.now()).toBe(1_704_067_200_000);
  });
});

describe('Logger seam', () => {
  it('ConsoleLogger forwards to console methods', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const logger = new ConsoleLogger();
      logger.debug('d');
      logger.info('i');
      logger.warn('w', { a: 1 });
      logger.error('e', new Error('x'));
      expect(debugSpy).toHaveBeenCalledWith('d');
      expect(infoSpy).toHaveBeenCalledWith('i');
      expect(warnSpy).toHaveBeenCalledWith('w', { a: 1 });
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      debugSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('NullLogger swallows everything without throwing', () => {
    const logger: Logger = new NullLogger();
    expect(() => {
      logger.debug('d');
      logger.info('i');
      logger.warn('w', { a: 1 });
      logger.error('e', new Error('x'));
    }).not.toThrow();
  });
});
