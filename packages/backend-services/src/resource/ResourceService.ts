import { AssumableRolesDAO, ResourceInventoryDAO } from '@aws-access-bridge/backend-data/dao';
import type { AssumableRoleOwner } from '@aws-access-bridge/backend-data/dao';

import type { ResourceInventoryItem } from '@aws-access-bridge/shared/model';
import { Pagination } from '@aws-access-bridge/backend-runtime/constants';
import type { ServiceEnv } from '../composition/ServiceEnv';
import { UserIdentityService } from '../identity/UserIdentityService';
import { resolveOwner } from '../identity/resolveOwner';

type ResourceServiceEnv = ServiceEnv;

interface ResourceSearchFilters {
  search?: string;
  type?: string;
  limit?: number;
  offset?: number;
  accountId?: string;
}

interface ResourceList {
  items: ResourceInventoryItem[];
  total: number;
  rolesByAccount: Record<string, string[]>;
}

interface ResourceSummary {
  totalResources: number;
  byType: Record<string, number>;
  byAccount: Record<string, Record<string, number>>;
}

class ResourceService {
  private readonly identity: UserIdentityService;

  constructor(
    private readonly env: ResourceServiceEnv,
    identity?: UserIdentityService,
  ) {
    this.identity = identity ?? new UserIdentityService(env);
  }


  private ownerFor(userEmail: string): Promise<AssumableRoleOwner> {
    return resolveOwner(this.identity, userEmail);
  }

  public async searchResources(userEmail: string, filters: ResourceSearchFilters = {}): Promise<ResourceList> {
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const owner: AssumableRoleOwner = await this.ownerFor(userEmail);
    const accessibleAccountIds: string[] = await assumableRolesDAO.getDistinctAccountIds(owner);

    let accountIds: string[] = accessibleAccountIds;
    if (filters.accountId) {
      // A filter naming an account the caller cannot reach reads as "no such
      // account" — the same answer as a filter that matches nothing. Narrowing
      // only on a hit used to leave `accountIds` untouched, so asking for an
      // inaccessible account returned *every* account the caller does have.
      if (!accessibleAccountIds.includes(filters.accountId)) {
        return { items: [], total: 0, rolesByAccount: {} };
      }
      accountIds = [filters.accountId];
    }

    const resourceDAO: ResourceInventoryDAO = new ResourceInventoryDAO(this.env.AccessBridgeDB);
    const { items, total } = await resourceDAO.searchResources(accountIds, filters.search, filters.type, Pagination.limit(filters.limit), Pagination.offset(filters.offset));
    const rolesByAccountEntries: Array<[string, string[]]> = await Promise.all(
      accountIds.map(async (accountId): Promise<[string, string[]]> => [
        accountId,
        await assumableRolesDAO.getRolesByUserAndAccount(owner, accountId),
      ]),
    );

    return { items, total, rolesByAccount: Object.fromEntries(rolesByAccountEntries) };
  }

  public async getSummary(userEmail: string): Promise<ResourceSummary> {
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const accountIds: string[] = await assumableRolesDAO.getDistinctAccountIds(await this.ownerFor(userEmail));

    const resourceDAO: ResourceInventoryDAO = new ResourceInventoryDAO(this.env.AccessBridgeDB);
    const counts: Record<string, Record<string, number>> = await resourceDAO.getResourceCounts(accountIds);

    let totalResources: number = 0;
    const byType: Record<string, number> = {};
    for (const accountCounts of Object.values(counts)) {
      for (const [type, count] of Object.entries(accountCounts)) {
        byType[type] = (byType[type] || 0) + count;
        totalResources += count;
      }
    }

    return { totalResources, byType, byAccount: counts };
  }
}export { ResourceService };
export type { ResourceList, ResourceSearchFilters, ResourceServiceEnv, ResourceSummary };
