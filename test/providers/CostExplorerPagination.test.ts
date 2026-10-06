import { describe, it, expect, vi } from 'vitest';
import { CostExplorerClient } from '@aws-access-bridge/provider-clients/aws/CostExplorerClient';
import type { AccessKeys } from '@aws-access-bridge/shared/model';

const KEYS: AccessKeys = { accessKeyId: 'AKID', secretAccessKey: 'SECRET', sessionToken: 'TOKEN' };

function pagedClient(...pages: Array<Response | Error>) {
  const bodies: string[] = [];
  let index = 0;
  const fetch = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.body) {
      bodies.push(String(init.body));
    }
    const next = pages[index++];
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    return Promise.resolve(next);
  });
  return { bodies, clientFactory: vi.fn().mockReturnValue({ fetch }), fetch };
}

function page(start: string, groups: Record<string, string>, nextPageToken?: string): Response {
  return new Response(
    JSON.stringify({
      ResultsByTime: [
        {
          TimePeriod: { Start: start, End: `${start}T23:59:59Z` },
          Groups: Object.entries(groups).map(([service, amount]) => ({
            Keys: [service],
            Metrics: { UnblendedCost: { Amount: amount, Unit: 'USD' } },
          })),
        },
      ],
      ...(nextPageToken ? { NextPageToken: nextPageToken } : {}),
    }),
    { status: 200, headers: { 'Content-Type': 'application/x-amz-json-1.1' } },
  );
}

/**
 * Cost Explorer pages `GetCostAndUsage` results and signals more remain with
 * `NextPageToken`. This is a spend-correctness bug, not a cosmetic one: the
 * totals computed from these groups are what `CostService` reports and what every
 * spend alert is evaluated against, so a truncated page reported spend *below* the
 * account's actual figure and an alert set near the real threshold could be missed
 * indefinitely. The shortfall is invisible because a partial page is a
 * well-formed response.
 */
describe('CostExplorerClient pagination', () => {
  it('follows NextPageToken until it is exhausted', async () => {
    const { bodies, clientFactory, fetch } = pagedClient(page('2025-01-01', { EC2: '10' }, 'tok-1'), page('2025-01-02', { S3: '20' }));

    const results = await new CostExplorerClient(clientFactory as never).getCostAndUsage(KEYS, '2025-01-01', '2025-01-31');

    expect(results.map((r) => r.periodStart)).toEqual(['2025-01-01', '2025-01-02']);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(bodies[0]).not.toContain('NextPageToken');
    expect(bodies[1]).toContain('NextPageToken');
    expect(bodies[1]).toContain('tok-1');
  });

  it('totals every page, so a multi-page breakdown is not under-reported', async () => {
    const { clientFactory } = pagedClient(page('2025-01-01', { EC2: '10' }, 'tok-1'), page('2025-01-01', { RDS: '5' }));

    const results = await new CostExplorerClient(clientFactory as never).getCostAndUsage(KEYS, '2025-01-01', '2025-01-31');

    // The whole account's daily spend, not just the first page's.
    expect(results.reduce((sum, r) => sum + r.totalCost, 0)).toBe(15);
  });

  /**
   * A service whose groups straddle a page boundary appears on both. Assignment
   * would keep only the later slice, so the accumulation is asserted directly.
   */
  it('merges one period split across pages into a single result', async () => {
    // The load-bearing case. `GetCostAndUsage` may split a period's service
    // groups over pages, and `CostDataDAO.upsertCostData` keys on
    // `(account, period_start)` with `INSERT OR REPLACE` — so emitting one result
    // per page would have the second silently replace the first, storing only the
    // last page's cost while still looking like a complete record.
    const { clientFactory } = pagedClient(page('2025-01-01', { EC2: '10' }, 'tok-1'), page('2025-01-01', { EC2: '7' }));

    const results = await new CostExplorerClient(clientFactory as never).getCostAndUsage(KEYS, '2025-01-01', '2025-01-31');

    expect(results).toHaveLength(1);
    expect(results[0].serviceBreakdown.EC2).toBe(17);
    expect(results[0].totalCost).toBe(17);
  });

  it('merges distinct services for one period across pages', async () => {
    const { clientFactory } = pagedClient(page('2025-01-01', { EC2: '10' }, 'tok-1'), page('2025-01-01', { RDS: '5' }));

    const [result] = await new CostExplorerClient(clientFactory as never).getCostAndUsage(KEYS, '2025-01-01', '2025-01-31');

    expect(result.serviceBreakdown).toEqual({ EC2: 10, RDS: 5 });
    expect(result.totalCost).toBe(15);
  });

  it('stops when NextPageToken is absent', async () => {
    const { clientFactory, fetch } = pagedClient(page('2025-01-01', { EC2: '10' }));
    await expect(new CostExplorerClient(clientFactory as never).getCostAndUsage(KEYS, '2025-01-01', '2025-01-31')).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('stops rather than looping when a token repeats', async () => {
    const stuck = (): Response => page('2025-01-01', { EC2: '10' }, 'same');
    const { clientFactory, fetch } = pagedClient(stuck(), stuck(), stuck());
    await new CostExplorerClient(clientFactory as never).getCostAndUsage(KEYS, '2025-01-01', '2025-01-31');
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('still throws on a non-OK page rather than returning a short breakdown', async () => {
    const { clientFactory } = pagedClient(page('2025-01-01', { EC2: '10' }, 'tok-1'), new Response('throttled', { status: 429 }));
    await expect(new CostExplorerClient(clientFactory as never).getCostAndUsage(KEYS, '2025-01-01', '2025-01-31')).rejects.toThrow(/Cost Explorer/);
  });

  it('throws on a malformed body, keeping the typed error taxonomy', async () => {
    const { clientFactory } = pagedClient(new Response('not json', { status: 200 }));
    await expect(new CostExplorerClient(clientFactory as never).getCostAndUsage(KEYS, '2025-01-01', '2025-01-31')).rejects.toThrow(/malformed/);
  });
});