import { apiRequest } from '../lib/api';

/**
 * Admin domain service (vertical slice). Previously 7 `admin/*Tab.tsx`
 * files + `OnboardingWizard` called the removed `apiFetch`/`apiCall` compat
 * layer directly (2–3 calls each, untyped `Record`), which left these typed
 * wrappers with no callers. Every admin mutation now goes through here.
 *
 * Each function's body is the one request that tab used to make inline, so this
 * is a move rather than a rewrite — but it did fix two latent mismatches that
 * had no caller to catch them: `cleanupOrphaned` typed the response as
 * `{deleted}` when the route returns per-table counts, and `enableDataCollection`
 * sent a singular `collectionType` where the route requires `collectionTypes`.
 */

async function setAccountNickname(awsAccountId: string, nickname: string): Promise<void> {
  await apiRequest<void>('/user/admin/account/nickname', { method: 'PUT', body: { awsAccountId, nickname } });
}

async function removeAccountNickname(awsAccountId: string): Promise<void> {
  await apiRequest<void>('/user/admin/account/nickname', { method: 'DELETE', body: { awsAccountId } });
}

async function storeCredentials(principalArn: string, accessKeyId: string, secretAccessKey: string, sessionToken?: string): Promise<void> {
  await apiRequest<void>('/user/admin/credentials', { method: 'POST', body: { principalArn, accessKeyId, secretAccessKey, sessionToken } });
}

async function storeCredentialRelationship(principalArn: string, assumedBy: string): Promise<void> {
  await apiRequest<void>('/user/admin/credentials/relationship', { method: 'POST', body: { principalArn, assumedBy } });
}

async function removeCredentialRelationship(principalArn: string): Promise<void> {
  await apiRequest<void>('/user/admin/credentials/relationship', { method: 'DELETE', body: { principalArn } });
}

async function validateCredentials(
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken?: string,
): Promise<{ arn: string; accountId: string }> {
  return apiRequest<{ arn: string; accountId: string }>('/user/admin/credentials/validate', {
    method: 'POST',
    body: { accessKeyId, secretAccessKey, sessionToken },
  });
}

async function testCredentialChain(principalArn: string): Promise<{ success: boolean; chain: Array<{ arn: string; status: string }> }> {
  return apiRequest<{ success: boolean; chain: Array<{ arn: string; status: string }> }>('/user/admin/credentials/test-chain', {
    method: 'POST',
    body: { principalArn },
  });
}

async function discoverAccountRoles(principalArn: string): Promise<{ roles: Array<{ roleName: string; arn: string; description: string }> }> {
  return apiRequest<{ roles: Array<{ roleName: string; arn: string; description: string }> }>('/user/admin/account/roles', {
    method: 'POST',
    body: { principalArn },
  });
}

/**
 * Per-table deletion counts. `cleanupOrphanedData` settles its seven table
 * deletes independently and reports per-table `failures`, so a partial run
 * still answers 200 — this shape is the route's, not a simplification of it.
 */
interface CleanupOrphanedResult {
  deletedCounts: {
    awsAccounts: number;
    roleConfigs: number;
    teamAccounts: number;
    spendAlerts: number;
    costData: number;
    resourceInventory: number;
    dataCollectionConfig: number;
  };
  totalDeleted: number;
  /**
   * Tables that could not be cleaned; empty on a fully successful run.
   */
  failures: string[];
}

/**
 * `userEmail` is optional: the route falls back to the authenticated admin, so
 * the client sends `undefined` rather than an empty string when the field is
 * blank. Typed optional here to keep that distinction expressible.
 */
async function grantAccess(userEmail: string | undefined, awsAccountId: string, roleName: string): Promise<void> {
  await apiRequest<void>('/user/admin/access', { method: 'POST', body: { userEmail, awsAccountId, roleName } });
}

async function revokeAccess(userEmail: string | undefined, awsAccountId: string, roleName: string): Promise<void> {
  await apiRequest<void>('/user/admin/access', { method: 'DELETE', body: { userEmail, awsAccountId, roleName } });
}

async function setRoleConfig(awsAccountId: string, roleName: string, config: Record<string, unknown>): Promise<void> {
  await apiRequest<void>('/user/admin/role/config', { method: 'PUT', body: { awsAccountId, roleName, ...config } });
}

async function deleteRoleConfig(awsAccountId: string, roleName: string): Promise<void> {
  await apiRequest<void>('/user/admin/role/config', { method: 'DELETE', body: { awsAccountId, roleName } });
}

/**
 * Enabling takes a list: the route requires `collectionTypes` (plural) and
 * applies them in one call. The singular `collectionType` this used to send was
 * a second latent bug in the service — it had no caller, so the mismatch was
 * never exercised, and the tab that bypassed it posted the plural form itself.
 */
async function enableDataCollection(principalArn: string, collectionTypes: string[]): Promise<void> {
  await apiRequest<void>('/user/admin/collection/config', { method: 'POST', body: { principalArn, collectionTypes } });
}

/**
 * Disabling takes one type: the route's DELETE branch names a single
 * `collectionType`, unlike POST's `collectionTypes`.
 */
async function disableDataCollection(principalArn: string, collectionType: string): Promise<void> {
  await apiRequest<void>('/user/admin/collection/config', { method: 'DELETE', body: { principalArn, collectionType } });
}

async function createSpendAlert(alert: Record<string, unknown>): Promise<{ id?: string }> {
  const data = await apiRequest<{ alert?: { id?: string } }>('/user/admin/costs/alerts', { method: 'POST', body: alert });
  return data.alert ?? {};
}

async function deleteSpendAlert(alertId: string): Promise<void> {
  await apiRequest<void>('/user/admin/costs/alerts', { method: 'DELETE', body: { alertId } });
}

async function cleanupOrphaned(): Promise<CleanupOrphanedResult> {
  return apiRequest<CleanupOrphanedResult>('/user/admin/maintenance/cleanup-orphaned', { method: 'POST' });
}

export type { CleanupOrphanedResult };
export {
  cleanupOrphaned,
  createSpendAlert,
  deleteRoleConfig,
  deleteSpendAlert,
  disableDataCollection,
  discoverAccountRoles,
  enableDataCollection,
  grantAccess,
  removeAccountNickname,
  removeCredentialRelationship,
  revokeAccess,
  setAccountNickname,
  setRoleConfig,
  storeCredentialRelationship,
  storeCredentials,
  testCredentialChain,
  validateCredentials,
};
