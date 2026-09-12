import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateSpendAlertRoute } from '@/endpoints/user/admin/costs/alerts/POST';
import { DeleteSpendAlertRoute } from '@/endpoints/user/admin/costs/alerts/DELETE';
import { EnableDataCollectionRoute } from '@/endpoints/user/admin/collection/config/POST';
import { DisableDataCollectionRoute } from '@/endpoints/user/admin/collection/config/DELETE';
import { CleanupOrphanedDataRoute } from '@/endpoints/user/admin/maintenance/cleanup-orphaned/POST';
import { ListTaskRunsRoute } from '@/endpoints/user/admin/maintenance/task-runs/GET';
import { SpendAlertDAO } from '@aws-access-bridge/backend-data/dao/SpendAlertDAO';
import { DataCollectionConfigDAO } from '@aws-access-bridge/backend-data/dao/DataCollectionConfigDAO';
import { BackgroundTaskRunDAO } from '@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO';
import { CostDataDAO } from '@aws-access-bridge/backend-data/dao/CostDataDAO';
import { ResourceInventoryDAO } from '@aws-access-bridge/backend-data/dao/ResourceInventoryDAO';
import { RoleConfigsDAO } from '@aws-access-bridge/backend-data/dao/RoleConfigsDAO';
import { TeamAccountsDAO } from '@aws-access-bridge/backend-data/dao/TeamAccountsDAO';
import { AwsAccountsDAO } from '@aws-access-bridge/backend-data/dao/AwsAccountsDAO';
import { UserMetadataDAO } from '@aws-access-bridge/backend-data/dao/UserMetadataDAO';
import { createRouteContext } from '../helpers/route-context';

vi.mock('@aws-access-bridge/backend-data/dao/SpendAlertDAO');
vi.mock('@aws-access-bridge/backend-data/dao/DataCollectionConfigDAO');
vi.mock('@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO');
vi.mock('@aws-access-bridge/backend-data/dao/CostDataDAO');
vi.mock('@aws-access-bridge/backend-data/dao/ResourceInventoryDAO');
vi.mock('@aws-access-bridge/backend-data/dao/RoleConfigsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/TeamAccountsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/AwsAccountsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/UserMetadataDAO');

function adminEnv() {
  vi.mocked(UserMetadataDAO.prototype.isSuperAdmin).mockResolvedValue(true);
  return {};
}

describe('spend alert routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /user/admin/costs/alerts creates alerts', async () => {
    vi.mocked(SpendAlertDAO.prototype.createAlert).mockResolvedValue({
      alertId: 'a1',
      awsAccountId: '123456789012',
      thresholdAmount: 100,
      currency: 'USD',
      periodType: 'monthly',
      createdBy: 'user@example.com',
      createdAt: 1,
      enabled: true,
    });
    const c = createRouteContext({
      method: 'POST',
      body: { awsAccountId: '123456789012', thresholdAmount: 100, periodType: 'monthly' },
      env: adminEnv(),
    });
    await new CreateSpendAlertRoute({} as never).handle(c as never);
    expect(SpendAlertDAO.prototype.createAlert).toHaveBeenCalledWith('123456789012', 100, 'monthly', 'user@example.com');
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('DELETE /user/admin/costs/alerts removes alerts', async () => {
    vi.mocked(SpendAlertDAO.prototype.deleteAlert).mockResolvedValue(undefined);
    const c = createRouteContext({
      method: 'DELETE',
      body: { alertId: 'a1' },
      env: adminEnv(),
    });
    await new DeleteSpendAlertRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('collection config routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /user/admin/collection/config enables types', async () => {
    vi.mocked(DataCollectionConfigDAO.prototype.create).mockResolvedValue(undefined);
    const c = createRouteContext({
      method: 'POST',
      body: { principalArn: 'arn:aws:iam::123456789012:role/Dev', collectionTypes: ['cost', 'resource'] },
      env: adminEnv(),
    });
    await new EnableDataCollectionRoute({} as never).handle(c as never);
    expect(DataCollectionConfigDAO.prototype.create).toHaveBeenCalledTimes(2);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('DELETE /user/admin/collection/config disables a type', async () => {
    vi.mocked(DataCollectionConfigDAO.prototype.delete).mockResolvedValue(undefined);
    const c = createRouteContext({
      method: 'DELETE',
      body: { principalArn: 'arn:aws:iam::123456789012:role/Dev', collectionType: 'cost' },
      env: adminEnv(),
    });
    await new DisableDataCollectionRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('maintenance routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /user/admin/maintenance/cleanup-orphaned purges all tables', async () => {
    vi.mocked(DataCollectionConfigDAO.prototype.deleteOrphaned).mockResolvedValue(1);
    vi.mocked(RoleConfigsDAO.prototype.deleteOrphaned).mockResolvedValue(2);
    vi.mocked(TeamAccountsDAO.prototype.deleteOrphaned).mockResolvedValue(3);
    vi.mocked(SpendAlertDAO.prototype.deleteOrphaned).mockResolvedValue(4);
    vi.mocked(CostDataDAO.prototype.deleteOrphaned).mockResolvedValue(5);
    vi.mocked(ResourceInventoryDAO.prototype.deleteOrphaned).mockResolvedValue(6);
    vi.mocked(AwsAccountsDAO.prototype.deleteOrphaned).mockResolvedValue(7);
    const c = createRouteContext({ method: 'POST', body: {}, env: adminEnv() });
    await new CleanupOrphanedDataRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ totalDeleted: 28 }));
  });

  it('GET /user/admin/maintenance/task-runs lists runs with filters', async () => {
    vi.mocked(BackgroundTaskRunDAO.prototype.listRuns).mockResolvedValue([
      {
        runId: 'r1',
        taskType: 'cost-data-collection',
        status: 'success',
        itemsProcessed: 3,
        itemsFailed: 0,
        summary: 'ok',
        details: null,
        errorMessage: null,
        startedAt: 1,
        completedAt: 2,
        createdAt: 1,
      },
    ]);
    const c = createRouteContext({
      url: 'https://example.com/user/admin/maintenance/task-runs?taskType=cost-data-collection&limit=10',
      env: adminEnv(),
    });
    await new ListTaskRunsRoute({} as never).handle(c as never);
    expect(BackgroundTaskRunDAO.prototype.listRuns).toHaveBeenCalledWith({
      taskType: 'cost-data-collection',
      status: undefined,
      limit: 10,
    });
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ runs: expect.any(Array) }));
  });
});
