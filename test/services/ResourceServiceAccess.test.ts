import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResourceService } from '@aws-access-bridge/backend-services/resource/ResourceService';
import { AssumableRolesDAO } from '@aws-access-bridge/backend-data/dao/AssumableRolesDAO';
import { ResourceInventoryDAO } from '@aws-access-bridge/backend-data/dao/ResourceInventoryDAO';
import { UserEmailDAO } from '@aws-access-bridge/backend-data/dao/UserEmailDAO';

vi.mock('@aws-access-bridge/backend-data/dao/AssumableRolesDAO');
vi.mock('@aws-access-bridge/backend-data/dao/ResourceInventoryDAO');
// Migration 0032: the identity lookup consults the address registry first, so an
// unstubbed one must read as "no registry row" and fall through to the anchor.
vi.mock('@aws-access-bridge/backend-data/dao/UserEmailDAO');

function db(): never {
  // A statement chain that satisfies construction; every method under test is
  // mocked, so nothing here is ever executed.
  const chain = { bind: () => chain, run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) };
  return { prepare: () => chain } as never;
}

const ENV = { AccessBridgeDB: db() } as never;

function service(): ResourceService {
  vi.mocked(UserEmailDAO.prototype.get).mockResolvedValue(null);
  return new ResourceService(ENV);
}

describe('ResourceService.searchResources account filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ResourceInventoryDAO.prototype.searchResources).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(AssumableRolesDAO.prototype.getRolesByUserAndAccount).mockResolvedValue([]);
  });

  /**
   * Regression: the filter only narrowed `accountIds` on a hit, so an account the
   * caller could not reach left the list untouched and the search returned
   * resources from *every* account they do have.
   */
  it('returns nothing for an account the caller cannot reach', async () => {
    vi.mocked(AssumableRolesDAO.prototype.getDistinctAccountIds).mockResolvedValue(['111111111111']);
    const result = await service().searchResources('user@example.com', { accountId: '999999999999' });
    expect(result).toEqual({ items: [], total: 0, rolesByAccount: {} });
    expect(ResourceInventoryDAO.prototype.searchResources).not.toHaveBeenCalled();
  });

  it('narrows to the requested account when it is accessible', async () => {
    vi.mocked(AssumableRolesDAO.prototype.getDistinctAccountIds).mockResolvedValue(['111111111111', '222222222222']);
    await service().searchResources('user@example.com', { accountId: '222222222222' });
    expect(ResourceInventoryDAO.prototype.searchResources).toHaveBeenCalledWith(['222222222222'], undefined, undefined, 50, 0);
  });

  it('searches every accessible account when no filter is given', async () => {
    vi.mocked(AssumableRolesDAO.prototype.getDistinctAccountIds).mockResolvedValue(['111111111111', '222222222222']);
    await service().searchResources('user@example.com');
    expect(ResourceInventoryDAO.prototype.searchResources).toHaveBeenCalledWith(['111111111111', '222222222222'], undefined, undefined, 50, 0);
  });

  it('returns nothing when the caller has no accessible accounts at all', async () => {
    vi.mocked(AssumableRolesDAO.prototype.getDistinctAccountIds).mockResolvedValue([]);
    await expect(service().searchResources('user@example.com', { accountId: '111111111111' })).resolves.toEqual({ items: [], total: 0, rolesByAccount: {} });
  });
});