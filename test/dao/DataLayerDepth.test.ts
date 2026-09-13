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
    await dao.upsertCostData({ awsAccountId: '1', periodStart: '2025-01-01', periodEnd: '2025-01-02', totalCost: 2, currency: 'USD', serviceBreakdown: { EC2: 2 }, collectedAt: 1 });
    expect(stmt.run).toHaveBeenCalledOnce();

    vi.mocked(stmt.all).mockResolvedValue({
      results: [
        { aws_account_id: '1', period_start: '2025-01-01', period_end: '2025-01-02', total_cost: 2, currency: 'USD', service_breakdown: '{"EC2":2}', collected_at: 1 },
        { aws_account_id: '1', period_start: '2025-01-03', period_end: '2025-01-04', total_cost: 0, currency: 'USD', service_breakdown: null, collected_at: 2 },
      ],
    } as never);
    const rows = await dao.getCostDataByAccount('1', '2025-01-01', '2025-01-04');
    expect(rows).toHaveLength(2);
    expect(rows[0].serviceBreakdown).toEqual({ EC2: 2 });
    expect(rows[1].serviceBreakdown).toEqual({});
  });

  it('short-circuits empty account lists', async () => {
    const { db, stmt } = mockDb();
    const dao = new CostDataDAO(db);
    await expect(dao.getCostDataForAccounts([], 'a', 'b')).resolves.toEqual([]);
    await expect(dao.getLatestCostSummary([])).resolves.toEqual([]);
    expect(stmt.bind).not.toHaveBeenCalled();
  });

  it('queries multi-account sets', async () => {
    const { db, stmt } = mockDb();
    vi.mocked(stmt.all).mockResolvedValue({ results: [] } as never);
    const dao = new CostDataDAO(db);
    await expect(dao.getCostDataForAccounts(['1', '2'], 'a', 'b')).resolves.toEqual([]);
    await expect(dao.getLatestCostSummary(['1'])).resolves.toEqual([]);
    expect(db.prepare).toHaveBeenCalledTimes(2);
  });
});

describe('SpendAlertDAO depth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates, lists, and maps enabled flags', async () => {
    const { db, stmt } = mockDb();
    const dao = new SpendAlertDAO(db);
    const alert = await dao.createAlert('1', 100, 'monthly', 'admin@example.com');
    expect(alert.alertId).toBeTruthy();
    expect(alert.enabled).toBe(true);

    vi.mocked(stmt.all).mockResolvedValue({
      results: [{ alert_id: 'a', aws_account_id: '1', threshold_amount: 100, currency: 'USD', period_type: 'monthly', created_by: 'x', created_at: 1, enabled: 0 }],
    } as never);
    const alerts = await dao.getAlertsByAccount('1');
    expect(alerts[0].enabled).toBe(false);
    await dao.deleteAlert('a');
    expect(stmt.bind).toHaveBeenCalled();
  });

  it('lists all alerts', async () => {
    const { db, stmt } = mockDb();
    vi.mocked(stmt.all).mockResolvedValue({ results: [] } as never);
    await expect(new SpendAlertDAO(db).getAllAlerts()).resolves.toEqual([]);
  });
});

describe('ResourceInventoryDAO depth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts, deletes stale, and searches with filters', async () => {
    const { db, stmt } = mockDb();
    const dao = new ResourceInventoryDAO(db);
    await dao.upsertResource({ awsAccountId: '1', region: 'us-east-1', resourceType: 'ec2', resourceId: 'i-1', resourceName: '', state: '', metadata: {}, collectedAt: 1 });
    await dao.deleteStaleResources('1', 'ec2', 5);
    expect(stmt.run).toHaveBeenCalledTimes(2);

    vi.mocked(stmt.first).mockResolvedValue({ total: 1 } as never);
    vi.mocked(stmt.all).mockResolvedValue({
      results: [{ aws_account_id: '1', region: 'r', resource_type: 'ec2', resource_id: 'i-1', resource_name: null, state: null, metadata: null, collected_at: 1 }],
    } as never);
    const result = await dao.searchResources(['1'], 'web', 'ec2', 10, 0);
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ resourceName: '', metadata: {} });
  });

  it('short-circuits empty searches and aggregates counts', async () => {
    const { db, stmt } = mockDb();
    const dao = new ResourceInventoryDAO(db);
    await expect(dao.searchResources([])).resolves.toEqual({ items: [], total: 0 });
    await expect(dao.getResourceCounts([])).resolves.toEqual({});
    vi.mocked(stmt.all).mockResolvedValue({
      results: [{ aws_account_id: '1', resource_type: 'ec2', count: 3 }],
    } as never);
    await expect(dao.getResourceCounts(['1'])).resolves.toEqual({ '1': { ec2: 3 } });
  });
});

describe('TeamAccountsDAO + DataCollectionConfigDAO depth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('manages team account membership', async () => {
    const { db, stmt } = mockDb();
    const dao = new TeamAccountsDAO(db);
    await dao.addAccountToTeam('t', '123456789012');
    await dao.removeAccountFromTeam('t', '123456789012');
    vi.mocked(stmt.all).mockResolvedValue({ results: [{ aws_account_id: '123456789012' }] } as never);
    await expect(dao.getAccountsByTeam('t')).resolves.toEqual(['123456789012']);
    vi.mocked(stmt.first).mockResolvedValue({ '1': 1 } as never);
    await expect(dao.isAccountInTeam('t', '123456789012')).resolves.toBe(true);
    vi.mocked(stmt.first).mockResolvedValue(null);
    await expect(dao.isAccountInTeam('t', '9')).resolves.toBe(false);
  });

  it('manages collection config rows', async () => {
    const { db, stmt } = mockDb();
    const dao = new DataCollectionConfigDAO(db);
    await dao.create('arn', 'cost');
    await dao.delete('arn', 'cost');
    vi.mocked(stmt.all).mockResolvedValue({ results: [{ principal_arn: 'arn' }] } as never);
    await expect(dao.getPrincipalArnsNeedingCollection('cost', 3, 1)).resolves.toEqual(['arn']);
    await dao.updateLastCollectedTime('arn', 'cost');
    expect(stmt.run).toHaveBeenCalled();
  });
});
