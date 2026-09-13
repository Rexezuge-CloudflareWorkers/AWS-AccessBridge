import { describe, it, expect } from 'vitest';
import { decodeCursor, encodeCursor } from '@aws-access-bridge/backend-data/utils';
import { computeDateCutoffIso, computeUnixCutoffSeconds, pruneInBatches } from '@aws-access-bridge/backend-data/utils';

describe('CursorUtil', () => {
  it('round-trips offsets opaquely', () => {
    expect(decodeCursor(encodeCursor(0))).toBe(0);
    expect(decodeCursor(encodeCursor(42))).toBe(42);
    expect(encodeCursor(7)).not.toContain('7');
  });

  it('returns 0 for missing or corrupt cursors', () => {
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor(null)).toBe(0);
    expect(decodeCursor('')).toBe(0);
    expect(decodeCursor('!!!not-a-cursor!!!')).toBe(0);
    expect(decodeCursor('bm90LWpzb24=')).toBe(0);
  });
});

describe('RepositoryHelper', () => {
  it('computes unix cutoff seconds from retention days', () => {
    expect(computeUnixCutoffSeconds(30, 1_700_000_000_000)).toBe(1_700_000_000 - 30 * 86_400);
  });

  it('computes ISO date cutoff', () => {
    expect(computeDateCutoffIso(1, Date.parse('2025-06-02T12:00:00Z'))).toBe('2025-06-01');
  });

  it('prunes in batches until a short batch', async () => {
    const seen: number[] = [];
    const total = await pruneInBatches(async () => {
      seen.push(1);
      return seen.length < 3 ? 2 : 0;
    }, 2);
    expect(total).toBe(4);
    expect(seen).toHaveLength(3);
  });
});
