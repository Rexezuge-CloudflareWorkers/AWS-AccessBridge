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

const OWNER = { userId: null, anchorEmail: 'user@example.com' };

function service(): ResourceService {
  vi.mocked(UserEmailDAO.prototype.get).mockResolvedValue(null);
  return new ResourceService(ENV);
}

function grant(...accounts: string[]): void {
  vi.mocked(AssumableRolesDAO.prototype.getRolesByOwner).mockResolvedValue(
    accounts.map((awsAccountId) => ({ awsAccountId, roleName: 'Dev' })),
  );
}

describe('ResourceService.searchResources account filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ResourceInventoryDAO.prototype.searchResources).mockResolvedValue({ items: [], total: 0 });
    grant('111111111111');
  });

  /**
   * The account filter is no longer a post-filter over a caller's whole account
   * list: it rides the DAO's own statement, which scopes rows by the owner
   * subquery *and* the account id. So an account the caller cannot reach yields
   * nothing there, rather than being caught by an in-service check that the
   * previous shape relied on.
   */
  it('passes the account filter to the DAO alongside the owner', async () => {
    await service().searchResources('user@example.com', { accountId: '999999999999' });
    expect(ResourceInventoryDAO.prototype.searchResources).toHaveBeenCalledWith(
      expect.objectContaining(OWNER),
      undefined,
      undefined,
      50,
      0,
      '999999999999',
    );
  });

  it('narrows the roles map to the requested account when it is accessible', async () => {
    grant('111111111111', '222222222222');
    const result = await service().searchResources('user@example.com', { accountId: '222222222222' });
    expect(result.rolesByAccount).toEqual({ '222222222222': ['Dev'] });
  });

  it('reports no roles for a filtered account the caller cannot reach', async () => {
    grant('111111111111');
    const result = await service().searchResources('user@example.com', { accountId: '999999999999' });
    expect(result.rolesByAccount).toEqual({});
  });

  it('searches every accessible account when no filter is given', async () => {
    grant('111111111111', '222222222222');
    const result = await service().searchResources('user@example.com');
    expect(Object.keys(result.rolesByAccount)).toEqual(['111111111111', '222222222222']);
    expect(ResourceInventoryDAO.prototype.searchResources).toHaveBeenCalledWith(
      expect.objectContaining(OWNER),
      undefined,
      undefined,
      50,
      0,
      undefined,
    );
  });

  it('returns nothing when the caller has no accessible accounts at all', async () => {
    grant();
    await expect(service().searchResources('user@example.com', { accountId: '111111111111' })).resolves.toEqual({
      items: [],
      total: 0,
      rolesByAccount: {},
    });
  });
});
