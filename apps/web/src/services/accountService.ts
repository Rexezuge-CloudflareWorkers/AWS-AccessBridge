import { buildPrincipalArn } from '@aws-access-bridge/shared';
import type { AccessKeysResponse } from '@aws-access-bridge/shared';
import { apiRequest } from '../lib/api';

type RoleMap = Record<string, { roles: string[]; hiddenRoles?: string[]; nickname?: string; favorite: boolean }>;

interface AccountsResult {
  roles: RoleMap;
  total: number;
}

interface ListAccountsOptions {
  showHidden: boolean;
  searchTerm: string;
  pageSize: number;
  currentPage: number;
}

async function listAccounts(options: ListAccountsOptions): Promise<AccountsResult> {
  const { showHidden, searchTerm, pageSize, currentPage } = options;
  let url: string;
  if (searchTerm.trim()) {
    const params = new URLSearchParams();
    params.set('q', searchTerm.trim());
    if (showHidden) params.set('showHidden', 'true');
    url = `/user/assumables/search?${params.toString()}`;
  } else {
    const offset = (currentPage - 1) * pageSize;
    const params = new URLSearchParams();
    if (showHidden) params.set('showHidden', 'true');
    params.set('limit', pageSize.toString());
    params.set('offset', offset.toString());
    url = `/user/assumables?${params.toString()}`;
  }

  const data = await apiRequest<RoleMap & { totalAccounts?: number }>(url);
  if (searchTerm.trim()) {
    return { roles: data, total: Object.keys(data).length };
  }
  const { totalAccounts: total, ...accounts } = data;
  return { roles: accounts, total: total ?? 0 };
}

async function setFavorite(accountId: string, isFavorite: boolean): Promise<void> {
  await apiRequest<void>('/user/favorites', {
    method: isFavorite ? 'DELETE' : 'POST',
    body: { awsAccountId: accountId },
  });
}

async function setRoleHidden(accountId: string, role: string, hide: boolean): Promise<void> {
  await apiRequest<void>('/user/assumable/hidden', {
    method: hide ? 'POST' : 'DELETE',
    body: { awsAccountId: accountId, roleName: role },
  });
}

async function assumeRoleKeys(accountId: string, role: string): Promise<AccessKeysResponse> {
  return apiRequest<AccessKeysResponse>('/user/aws/assume-role', {
    method: 'POST',
    body: { principalArn: buildPrincipalArn(accountId, role) },
  });
}

/**
 * The console-destination parameters `GET /user/aws/federate` accepts alongside
 * the required pair. `FederateQuerySchema` on the server defines which are legal;
 * this is the client half of that contract.
 */
interface FederateDestination {
  destinationPath?: string;
  destinationRegion?: string;
}

/**
 * Builds the federate URL.
 *
 * Previously this took only `(accountId, role)` while `ResourceInventory` built
 * the same endpoint by hand with `URLSearchParams` to add the two destination
 * parameters — two string builders against one server-side schema, which is how a
 * parameter name or an encoding difference would go unnoticed. `URLSearchParams`
 * handles encoding for every value, so a role name containing `&` or `#` cannot
 * truncate the query.
 */
function buildFederateUrl(accountId: string, role: string, destination?: FederateDestination): string {
  const params = new URLSearchParams({ awsAccountId: accountId, role });
  if (destination?.destinationPath) {
    params.set('destinationPath', destination.destinationPath);
  }
  if (destination?.destinationRegion) {
    params.set('destinationRegion', destination.destinationRegion);
  }
  return `/user/aws/federate?${params.toString()}`;
}

export type { FederateDestination, RoleMap, AccountsResult, ListAccountsOptions };
export { listAccounts, setFavorite, setRoleHidden, assumeRoleKeys, buildFederateUrl };
