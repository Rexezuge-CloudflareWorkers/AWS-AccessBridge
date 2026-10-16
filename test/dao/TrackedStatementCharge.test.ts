import { describe, expect, it } from 'vitest';
import { SubrequestCounter } from '@rexezuge/shared';
import { CostDataDAO } from '@aws-access-bridge/backend-data/dao/CostDataDAO';
import { ResourceInventoryDAO } from '@aws-access-bridge/backend-data/dao/ResourceInventoryDAO';

/**
 * Every statement charges the meter, `runTracked` included.
 *
 * `@rexezuge/d1` 1.8.0 charges `run`, `first`, `all` and `batch` but leaves
 * `runTracked` uncharged, so the local `BaseDAO` restores the charge. The
 * property matters because `runTracked` is the write path whose *cost* is
 * deliberately accounted: a write that spends a D1 subrequest nobody counted is
 * invisible to every budget that decides how much work an invocation may do.
 */
describe('the subrequest meter counts writes', () => {
  function db(): D1Database {
    const statement = {
      bind: (): unknown => statement,
      run: async (): Promise<unknown> => ({ success: true, meta: { changes: 1 } }),
    };
    return { prepare: (): unknown => statement } as unknown as D1Database;
  }

  it('charges one d1 subrequest for runTracked', async () => {
    const meter = new SubrequestCounter(1000);
    const dao = new ResourceInventoryDAO(db() as never, meter);

    await dao.upsertResource({
      awsAccountId: '123456789012',
      region: 'us-east-1',
      resourceType: 'ec2',
      resourceId: 'i-1',
      resourceName: 'web',
      state: 'running',
      metadata: {},
      collectedAt: 1,
    });

    expect(meter.spent).toBe(1);
    expect(meter.breakdown().d1).toBe(1);
  });

  it('charges one d1 subrequest for run', async () => {
    const meter = new SubrequestCounter(1000);
    const dao = new CostDataDAO(db() as never, meter);

    await dao.upsertCostData({
      awsAccountId: '123456789012',
      periodStart: '2025-01-01',
      periodEnd: '2025-01-02',
      totalCost: 1,
      currency: 'USD',
      serviceBreakdown: {},
      collectedAt: 1,
    });

    expect(meter.spent).toBe(1);
    expect(meter.breakdown().d1).toBe(1);
  });
});
