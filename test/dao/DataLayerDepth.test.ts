import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostDataDAO } from '@aws-access-bridge/backend-data/dao/CostDataDAO';
import { SpendAlertDAO } from '@aws-access-bridge/backend-data/dao/SpendAlertDAO';
import { ResourceInventoryDAO } from '@aws-access-bridge/backend-data/dao/ResourceInventoryDAO';
import { TeamAccountsDAO } from '@aws-access-bridge/backend-data/dao/TeamAccountsDAO';
import { DataCollectionConfigDAO } from '@aws-access-bridge/backend-data/dao/DataCollectionConfigDAO';

function mockDb() {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
  };
  const db = { prepare: vi.fn().mockReturnValue(stmt), exec: vi.fn(), batch: vi.fn() };
  return { db: db as unknown as D1Database, stmt };
}

describe('CostDataDAO depth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts and maps rows with and without breakdowns', async () => {
    const { db, stmt } = mockDb();
    const dao = new CostDataDAO(db);
    await dao.upsertCostData({
      awsAccountId: '1',
      periodStart: '2025-01-01',
      periodEnd: '2025-01-02',
      totalCost: 2,
      currency: 'USD',
      serviceBreakdown: { EC2: 2 },
      collectedAt: 1,
    });
    expect(stmt.run).toHaveBeenCalledOnce();

    vi.mocked(stmt.all).mockResolvedValue({
      results: [
        {
          aws_account_id: '1',
          period_start: '2025-01-01',
          period_end: '2025-01-02',
          total_cost: 2,
          currency: 'USD',
          service_breakdown: '{"EC2":2}',
          collected_at: 1,
        },
        {
          aws_account_id: '1',
          period_start: '2025-01-03',
          period_end: '2025-01-04',
          total_cost: 0,
          currency: 'USD',
          service_breakdown: null,
          collected_at: 2,
        },
      ],
    });
    const rows = await dao.getCostDataByAccount('1', '2025-01-01', '2025-01-04');
    expect(rows).toHaveLength(2);
    expect(rows[0].serviceBreakdown).toEqual({ EC2: 2 });
    expect(rows[1].serviceBreakdown).toEqual({});
  });

  it('scopes the account set inside the statement by the owner predicate', async () => {
    const { db, stmt } = mockDb();
    vi.mocked(stmt.all).mockResolvedValue({ results: [] });
    const dao = new CostDataDAO(db);
    // The account list is a subquery rather than a bound `IN (?,...)` list:
    // D1 caps bound parameters per statement, so a caller with a hundred
    // accessible accounts would otherwise fail the statement outright.
    await expect(dao.getCostDataForOwner({ userId: 'usr_1', anchorEmail: 'u@e.com' }, 'a', 'b')).resolves.toEqual([]);
    expect(db.prepare).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.prepare).mock.calls[0][0]).toContain('IN (SELECT DISTINCT aws_account_id FROM assumable_roles');
    expect(stmt.bind).toHaveBeenCalledWith('usr_1', 'u@e.com', 'a', 'b');
  });
});

describe('SpendAlertDAO depth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates and deletes alerts', async () => {
    const { db, stmt } = mockDb();
    const dao = new SpendAlertDAO(db);
    const alert = await dao.createAlert('1', 100, 'monthly', 'admin@example.com');
    expect(alert.alertId).toBeTruthy();
    expect(alert.enabled).toBe(true);

    await dao.deleteAlert('a');
    expect(stmt.bind).toHaveBeenCalled();
  });
});

describe('ResourceInventoryDAO depth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts, deletes stale, and searches with filters', async () => {
    const { db, stmt } = mockDb();
    const dao = new ResourceInventoryDAO(db);
    await dao.upsertResource({
      awsAccountId: '1',
      region: 'us-east-1',
      resourceType: 'ec2',
      resourceId: 'i-1',
      resourceName: '',
      state: '',
      metadata: {},
      collectedAt: 1,
    });
    await dao.deleteStaleResources('1', 'ec2', 5);
    expect(stmt.run).toHaveBeenCalledTimes(2);

    vi.mocked(stmt.first).mockResolvedValue({ total: 1 });
    vi.mocked(stmt.all).mockResolvedValue({
      results: [
        {
          aws_account_id: '1',
          region: 'r',
          resource_type: 'ec2',
          resource_id: 'i-1',
          resource_name: null,
          state: null,
          metadata: null,
          collected_at: 1,
        },
      ],
    });
    const result = await dao.searchResources({ userId: 'usr_1', anchorEmail: 'u@e.com' }, 'web', 'ec2', 10, 0);
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ resourceName: '', metadata: {} });
  });

  it('scopes counts by the owner predicate and aggregates per account', async () => {
    const { db, stmt } = mockDb();
    const dao = new ResourceInventoryDAO(db);
    vi.mocked(stmt.all).mockResolvedValue({
      results: [{ aws_account_id: '1', resource_type: 'ec2', count: 3 }],
    });
    await expect(dao.getResourceCounts({ userId: 'usr_1', anchorEmail: 'u@e.com' })).resolves.toEqual({ '1': { ec2: 3 } });
  });
});

describe('TeamAccountsDAO + DataCollectionConfigDAO depth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('manages team account membership', async () => {
    const { db, stmt } = mockDb();
    const dao = new TeamAccountsDAO(db);
    await dao.addAccountToTeam('t', '123456789012');
    await dao.removeAccountFromTeam('t', '123456789012');
    vi.mocked(stmt.all).mockResolvedValue({ results: [{ aws_account_id: '123456789012' }] });
    await expect(dao.getAccountsByTeam('t')).resolves.toEqual(['123456789012']);
  });

  it('manages collection config rows', async () => {
    const { db, stmt } = mockDb();
    const dao = new DataCollectionConfigDAO(db);
    await dao.create('arn', 'cost');
    await dao.delete('arn', 'cost');
    vi.mocked(stmt.all).mockResolvedValue({ results: [{ principal_arn: 'arn' }] });
    await expect(dao.getPrincipalArnsNeedingCollection('cost', 3, 1)).resolves.toEqual(['arn']);
    await dao.updateLastCollectedTime('arn', 'cost');
    expect(stmt.run).toHaveBeenCalled();
  });
});
