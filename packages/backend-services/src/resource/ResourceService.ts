import { AssumableRolesDAO, ResourceInventoryDAO } from '@aws-access-bridge/backend-data/dao';
import type { AssumableRoleOwner } from '@aws-access-bridge/backend-data/dao';

import type { ResourceInventoryItem } from '@aws-access-bridge/shared/model';
import { Pagination } from '@aws-access-bridge/backend-runtime/constants';
import type { ServiceEnv } from '../composition/ServiceEnv';
import { UserIdentityService } from '../identity/UserIdentityService';
import { resolveOwner } from '../identity/resolveOwner';

type ResourceServiceEnv = ServiceEnv;

function groupRolesByAccount(rows: Array<{ awsAccountId: string; roleName: string }>): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const row of rows) {
    const bucket: string[] | undefined = grouped[row.awsAccountId];
    if (bucket) {
      bucket.push(row.roleName);
    } else {
      grouped[row.awsAccountId] = [row.roleName];
    }
  }
  return grouped;
}

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

    const resourceDAO: ResourceInventoryDAO = new ResourceInventoryDAO(this.env.AccessBridgeDB);
    const { items, total } = await resourceDAO.searchResources(
      owner,
      filters.search,
      filters.type,
      Pagination.limit(filters.limit),
      Pagination.offset(filters.offset),
      filters.accountId,
    );
    // One query for the whole roles map: a per-account fan-out is N round
    // trips for data that is a single scan over the caller's grants.
    let rolesByAccount: Record<string, string[]> = groupRolesByAccount(await assumableRolesDAO.getRolesByOwner(owner));
    if (filters.accountId) {
      // The account filter narrows rolesByAccount to the same account: the
      // client renders it span-by-span next to the items.
      const rolesForAccount: string[] | undefined = rolesByAccount[filters.accountId];
      rolesByAccount = rolesForAccount ? { [filters.accountId]: rolesForAccount } : {};
    }

    return { items, total, rolesByAccount };
  }

  public async getSummary(userEmail: string): Promise<ResourceSummary> {
    const owner: AssumableRoleOwner = await this.ownerFor(userEmail);

    const resourceDAO: ResourceInventoryDAO = new ResourceInventoryDAO(this.env.AccessBridgeDB);
    const counts: Record<string, Record<string, number>> = await resourceDAO.getResourceCounts(owner);

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
}
export { ResourceService };
export type { ResourceList, ResourceSearchFilters, ResourceServiceEnv, ResourceSummary };
