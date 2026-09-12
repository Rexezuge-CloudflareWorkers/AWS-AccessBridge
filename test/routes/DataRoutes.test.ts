import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetCostSummaryRoute } from '@/endpoints/user/costs/summary/GET';
import { GetAccountCostRoute } from '@/endpoints/user/costs/account/GET';
import { GetCostTrendsRoute } from '@/endpoints/user/costs/trends/GET';
import { ListResourcesRoute } from '@/endpoints/user/resources/GET';
import { GetResourceSummaryRoute } from '@/endpoints/user/resources/summary/GET';
import { ListAuditLogsRoute } from '@/endpoints/user/admin/audit-logs/GET';
import { AssumableRolesDAO } from '@aws-access-bridge/backend-data/dao/AssumableRolesDAO';
import { CostDataDAO } from '@aws-access-bridge/backend-data/dao/CostDataDAO';
import { ResourceInventoryDAO } from '@aws-access-bridge/backend-data/dao/ResourceInventoryDAO';
import { AuditLogDAO } from '@aws-access-bridge/backend-data/dao/AuditLogDAO';
import { UserMetadataDAO } from '@aws-access-bridge/backend-data/dao/UserMetadataDAO';
import { createRouteContext } from '../helpers/route-context';

vi.mock('@aws-access-bridge/backend-data/dao/AssumableRolesDAO');
vi.mock('@aws-access-bridge/backend-data/dao/CostDataDAO');
vi.mock('@aws-access-bridge/backend-data/dao/ResourceInventoryDAO');
vi.mock('@aws-access-bridge/backend-data/dao/AuditLogDAO');
vi.mock('@aws-access-bridge/backend-data/dao/UserMetadataDAO');

function userEnv() {
  return {};
}

describe('cost routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /user/costs/summary aggregates account costs', async () => {
    vi.mocked(AssumableRolesDAO.prototype.getDistinctAccountIds).mockResolvedValue(['123456789012']);
    vi.mocked(CostDataDAO.prototype.getCostDataForAccounts).mockResolvedValue([
      {
        awsAccountId: '123456789012',
        periodStart: '2025-01-01',
        periodEnd: '2025-01-02',
        totalCost: 1.5,
        currency: 'USD',
        serviceBreakdown: {},
        collectedAt: 1,
      },
    ]);
    const c = createRouteContext({ url: 'https://example.com/user/costs/summary', env: userEnv() });
    await new GetCostSummaryRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ grandTotal: 1.5 }));
  });

  it('GET /user/costs/summary returns empty for users without accounts', async () => {
    vi.mocked(AssumableRolesDAO.prototype.getDistinctAccountIds).mockResolvedValue([]);
    const c = createRouteContext({ url: 'https://example.com/user/costs/summary', env: userEnv() });
    await new GetCostSummaryRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith({ accounts: {}, grandTotal: 0 });
  });

  it('GET /user/costs/account enforces account access', async () => {
    vi.mocked(AssumableRolesDAO.prototype.getRolesByUserAndAccount).mockResolvedValue([]);
    const c = createRouteContext({ url: 'https://example.com/user/costs/account?awsAccountId=123456789012', env: userEnv() });
    await new GetAccountCostRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ Exception: expect.objectContaining({ Type: 'Forbidden' }) }), 403);
  });

  it('GET /user/costs/account returns cost breakdown', async () => {
    vi.mocked(AssumableRolesDAO.prototype.getRolesByUserAndAccount).mockResolvedValue(['Dev']);
    vi.mocked(CostDataDAO.prototype.getCostDataByAccount).mockResolvedValue([
      {
        awsAccountId: '123456789012',
        periodStart: '2025-01-01',
        periodEnd: '2025-01-02',
        totalCost: 2,
        currency: 'USD',
        serviceBreakdown: { EC2: 2 },
        collectedAt: 1,
      },
    ]);
    const c = createRouteContext({ url: 'https://example.com/user/costs/account?awsAccountId=123456789012', env: userEnv() });
    await new GetAccountCostRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ total: 2 }));
  });

  it('GET /user/costs/trends aggregates by month', async () => {
    vi.mocked(AssumableRolesDAO.prototype.getDistinctAccountIds).mockResolvedValue(['123456789012']);
    vi.mocked(CostDataDAO.prototype.getCostDataForAccounts).mockResolvedValue([
      {
        awsAccountId: '123456789012',
        periodStart: '2025-01-05',
        periodEnd: '2025-01-06',
        totalCost: 3,
        currency: 'USD',
        serviceBreakdown: {},
        collectedAt: 1,
      },
    ]);
    const c = createRouteContext({ url: 'https://example.com/user/costs/trends?months=6', env: userEnv() });
    await new GetCostTrendsRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ months: expect.any(Array) }));
  });
});

describe('resource routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /user/resources searches with roles by account', async () => {
    vi.mocked(AssumableRolesDAO.prototype.getDistinctAccountIds).mockResolvedValue(['123456789012']);
    vi.mocked(ResourceInventoryDAO.prototype.searchResources).mockResolvedValue({
      items: [
        {
          awsAccountId: '123456789012',
          region: 'us-east-1',
          resourceType: 'ec2',
          resourceId: 'i-1',
          resourceName: 'web',
          state: 'running',
          metadata: {},
          collectedAt: 1,
        },
      ],
      total: 1,
    });
    vi.mocked(AssumableRolesDAO.prototype.getRolesByUserAndAccount).mockResolvedValue(['Dev']);
    const c = createRouteContext({ url: 'https://example.com/user/resources?type=ec2&limit=50&offset=0', env: userEnv() });
    await new ListResourcesRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ total: 1, rolesByAccount: { '123456789012': ['Dev'] } }));
  });

  it('GET /user/resources/summary aggregates counts', async () => {
    vi.mocked(AssumableRolesDAO.prototype.getDistinctAccountIds).mockResolvedValue(['123456789012']);
    vi.mocked(ResourceInventoryDAO.prototype.getResourceCounts).mockResolvedValue({ '123456789012': { ec2: 2, s3: 1 } });
    const c = createRouteContext({ url: 'https://example.com/user/resources/summary', env: userEnv() });
    await new GetResourceSummaryRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ totalResources: 3, byType: { ec2: 2, s3: 1 } }));
  });
});

describe('audit logs route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(UserMetadataDAO.prototype.isSuperAdmin).mockResolvedValue(true);
  });

  it('GET /user/admin/audit-logs queries with filters', async () => {
    vi.mocked(AuditLogDAO.prototype.query).mockResolvedValue({ logs: [], total: 0 });
    const c = createRouteContext({ url: 'https://example.com/user/admin/audit-logs?action=ASSUME_ROLE&limit=50&offset=0', env: {} });
    await new ListAuditLogsRoute({} as never).handle(c as never);
    expect(AuditLogDAO.prototype.query).toHaveBeenCalledWith(expect.objectContaining({ action: 'ASSUME_ROLE' }), 50, 0);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ total: 0 }));
  });
});
