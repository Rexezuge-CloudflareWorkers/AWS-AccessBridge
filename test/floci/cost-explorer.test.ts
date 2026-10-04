import { describe, expect, it } from 'vitest';
import { CostExplorerService } from '@aws-access-bridge/backend-services/aws';
import type { CostExplorerResult } from '@aws-access-bridge/backend-services/aws';
import { ACCOUNT_A, accountKeys, flociClientFactory } from './helpers/floci';
import { createBucketWithObject } from './helpers/seed';

/**
 * Cost Explorer over a real signed round trip.
 *
 * The JSON 1.1 protocol is the one AWS surface here that is not XML and not
 * query-string, and its `X-Amz-Target` header is the whole routing mechanism —
 * so a typo there surfaces as a 404 from the emulator rather than as a parse
 * error, which is exactly the class of defect a stubbed test cannot see.
 *
 * Floci synthesizes amounts from its own resource state, so the assertions below
 * are about our parser over a real body with real numbers in it, not about the
 * emulator's pricing model being correct.
 */

/** Window covering the current month, in the `YYYY-MM-DD` shape the API takes. */
function currentMonth(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

describe('Cost Explorer against Floci', () => {
  it('parses a priced period from a real GetCostAndUsage response', async () => {
    await createBucketWithObject('floci-cost-bucket');
    const service = new CostExplorerService(flociClientFactory());
    const { start, end } = currentMonth();

    const results: CostExplorerResult[] = await service.getCostAndUsage(accountKeys(ACCOUNT_A), start, end, 'MONTHLY');

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(Number.isFinite(result.totalCost)).toBe(true);
      expect(result.currency).toBe('USD');
      // The client falls back to the requested window when a response omits its
      // `TimePeriod`, and otherwise passes the service's value through verbatim.
      // The exact shape is the service's business — AWS and Floci both answer
      // `2026-10-01T00:00:00Z` rather than a bare day, which an earlier
      // day-only assertion here got wrong. What our parser owes is a
      // non-empty, parseable date rather than `undefined`.
      expect(result.periodStart).toBeTruthy();
      expect(result.periodEnd).toBeTruthy();
      expect(Number.isNaN(Date.parse(result.periodStart))).toBe(false);
      expect(Number.isNaN(Date.parse(result.periodEnd))).toBe(false);
    }

    // The parser skips any group at or below zero, so a positive breakdown is
    // proof the amounts were read as numbers rather than kept as strings.
    const priced = results.flatMap((result) => Object.entries(result.serviceBreakdown));
    expect(priced.length).toBeGreaterThan(0);
    for (const [serviceName, amount] of priced) {
      expect(typeof serviceName).toBe('string');
      expect(amount).toBeGreaterThan(0);
    }

    // Matched loosely on purpose: Floci derives the SERVICE dimension value from
    // its own enumerator names, so pinning an exact string would couple this test
    // to emulator naming rather than to our parser.
    expect(priced.some(([serviceName]) => /s3|storage/i.test(serviceName))).toBe(true);
  });

  it('rounds the total to cents while leaving breakdown amounts exact', async () => {
    const service = new CostExplorerService(flociClientFactory());
    const { start, end } = currentMonth();

    const results: CostExplorerResult[] = await service.getCostAndUsage(accountKeys(ACCOUNT_A), start, end, 'MONTHLY');

    for (const result of results) {
      const summed: number = Object.values(result.serviceBreakdown).reduce((total, amount) => total + amount, 0);
      // `CostExplorerClient` applies `MoneyUtil.round` to the total and leaves
      // each group's amount as parsed, so the two deliberately differ for
      // anything with more than two decimals. Restated rather than imported, so
      // a change to `MoneyUtil` surfaces here as a contract change instead of
      // being silently restated along with it.
      expect(result.totalCost).toBe(Math.round(summed * 100) / 100);
    }
  });
});
