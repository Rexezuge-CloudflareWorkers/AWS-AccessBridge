import { AssumableRolesDAO, ResourceInventoryDAO } from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import type { ResourceInventoryItem } from '@aws-access-bridge/shared/model';

interface ResourceServiceEnv {
  AccessBridgeDB: D1Queryable;
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
  constructor(private readonly env: ResourceServiceEnv) {}

  public async searchResources(userEmail: string, filters: ResourceSearchFilters = {}): Promise<ResourceList> {
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    let accountIds: string[] = await assumableRolesDAO.getDistinctAccountIds(userEmail);

    if (filters.accountId && accountIds.includes(filters.accountId)) {
      accountIds = [filters.accountId];
    }

    const resourceDAO: ResourceInventoryDAO = new ResourceInventoryDAO(this.env.AccessBridgeDB);
    const { items, total } = await resourceDAO.searchResources(
      accountIds,
      filters.search,
      filters.type,
      Math.min(filters.limit ?? 50, 200),
      Math.max(filters.offset ?? 0, 0),
    );
    const rolesByAccountEntries: Array<[string, string[]]> = await Promise.all(
      accountIds.map(async (accountId): Promise<[string, string[]]> => [
        accountId,
        await assumableRolesDAO.getRolesByUserAndAccount(userEmail, accountId),
      ]),
    );

    return { items, total, rolesByAccount: Object.fromEntries(rolesByAccountEntries) };
  }

  public async getSummary(userEmail: string): Promise<ResourceSummary> {
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const accountIds: string[] = await assumableRolesDAO.getDistinctAccountIds(userEmail);

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
}

class ResourceServiceFactory {
  public static create(env: ResourceServiceEnv): ResourceService {
    return new ResourceService(env);
  }
}

export { ResourceService, ResourceServiceFactory };
export type { ResourceList, ResourceSearchFilters, ResourceServiceEnv, ResourceSummary };
