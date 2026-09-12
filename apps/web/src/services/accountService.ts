import { buildPrincipalArn } from '@aws-access-bridge/shared';
import type { AccessKeysResponse } from '@aws-access-bridge/shared';
import { readJson, throwForResponse } from '../lib/api';

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

  const res = await fetch(url);
  if (!res.ok) {
    await throwForResponse(res, 'Failed to load accounts');
  }
  const data = await readJson<RoleMap & { totalAccounts?: number }>(res);
  if (searchTerm.trim()) {
    return { roles: data, total: Object.keys(data).length };
  }
  const { totalAccounts: total, ...accounts } = data;
  return { roles: accounts, total: total ?? 0 };
}

async function setFavorite(accountId: string, isFavorite: boolean): Promise<void> {
  const response = await fetch('/user/favorites', {
    method: isFavorite ? 'DELETE' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ awsAccountId: accountId }),
  });
  if (!response.ok) {
    await throwForResponse(response, `Failed to ${isFavorite ? 'unfavorite' : 'favorite'} account`);
  }
}

async function setRoleHidden(accountId: string, role: string, hide: boolean): Promise<void> {
  const response = await fetch('/user/assumable/hidden', {
    method: hide ? 'POST' : 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ awsAccountId: accountId, roleName: role }),
  });
  if (!response.ok) {
    await throwForResponse(response, `Failed to ${hide ? 'hide' : 'unhide'} role`);
  }
}

async function assumeRoleKeys(accountId: string, role: string): Promise<AccessKeysResponse> {
  const assumeRes = await fetch('/user/aws/assume-role', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ principalArn: buildPrincipalArn(accountId, role) }),
  });
  if (!assumeRes.ok) {
    await throwForResponse(assumeRes, 'Assume role failed');
  }
  return readJson<AccessKeysResponse>(assumeRes);
}

function buildFederateUrl(accountId: string, role: string): string {
  return `/user/aws/federate?awsAccountId=${accountId}&role=${encodeURIComponent(role)}`;
}

export type { RoleMap, AccountsResult, ListAccountsOptions };
export { listAccounts, setFavorite, setRoleHidden, assumeRoleKeys, buildFederateUrl };
