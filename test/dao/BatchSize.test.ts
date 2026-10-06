import { describe, it, expect } from 'vitest';
import { DEFAULT_BATCH_SIZE, toSafeBatchSize } from '@aws-access-bridge/backend-data/dao/BatchSize';

/**
 * A batch `LIMIT ?` that is non-numeric or non-positive is rejected by D1, so
 * these three shapes would turn a routine cron batch into a hard failure. The
 * job they guard is background work nobody is watching, which is exactly why the
 * failure would go unnoticed until a cache stopped refreshing.
 */
describe('toSafeBatchSize', () => {
  it('passes a usable batch size through unchanged', () => {
    expect(toSafeBatchSize(1)).toBe(1);
    expect(toSafeBatchSize(10)).toBe(10);
    expect(toSafeBatchSize(500)).toBe(500);
  });

  it('falls back rather than binding a limit D1 would reject', () => {
    for (const bad of [0, -1, NaN, Infinity, 1.5, 2.5]) {
      expect(toSafeBatchSize(bad), String(bad)).toBe(DEFAULT_BATCH_SIZE);
    }
  });

  it('falls back for an unsafe integer, which would overflow the bind', () => {
    expect(toSafeBatchSize(Number.MAX_SAFE_INTEGER + 2)).toBe(DEFAULT_BATCH_SIZE);
  });

  /**
   * A caller with its own safe default passes it, rather than having every task
   * silently degrade to the same batch size.
   */
  it('honours an overridden fallback', () => {
    expect(toSafeBatchSize(0, 3)).toBe(3);
    expect(toSafeBatchSize(-5, 3)).toBe(3);
  });

  it('matches the pruning default, so a degraded batch behaves like a prune', () => {
    expect(DEFAULT_BATCH_SIZE).toBe(500);
  });
});