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

/**
 * The identity AWS reports for a set of credentials (`sts:GetCallerIdentity`).
 */
interface ValidatedIdentity {
  arn: string;
  accountId: string;
}

/**
 * One hop of a credential-chain test: the role assumed and how it went. A status
 * beginning `ok` is a pass; anything else is the failure text.
 */
interface ChainTestEntry {
  arn: string;
  status: string;
}

interface ChainTestResult {
  success: boolean;
  chain: ChainTestEntry[];
}

/**
 * An IAM role found in an account. A role typed in by hand has an empty `arn`.
 */
interface DiscoveredRole {
  roleName: string;
  arn: string;
  description: string;
}

interface DiscoveredRolesResult {
  roles: DiscoveredRole[];
}

/**
 * The spend-alert body the route accepts (`CreateSpendAlertBodySchema`).
 * `thresholdAmount` is a number, not the form's string, and strictly positive.
 */
interface SpendAlertInput {
  awsAccountId: string;
  thresholdAmount: number;
  periodType?: string;
}

/**
 * The optional fields of a role configuration. A field is *omitted* to leave it
 * alone — the route distinguishes "not supplied" from "set to empty".
 */
interface RoleConfigOptions {
  destinationPath?: string;
  destinationRegion?: string;
  roleSessionDurationSeconds?: number;
}

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

async function validateCredentials(accessKeyId: string, secretAccessKey: string, sessionToken?: string): Promise<ValidatedIdentity> {
  return apiRequest<ValidatedIdentity>('/user/admin/credentials/validate', {
    method: 'POST',
    body: { accessKeyId, secretAccessKey, sessionToken },
  });
}

async function testCredentialChain(principalArn: string): Promise<ChainTestResult> {
  return apiRequest<ChainTestResult>('/user/admin/credentials/test-chain', {
    method: 'POST',
    body: { principalArn },
  });
}

async function discoverAccountRoles(principalArn: string): Promise<DiscoveredRolesResult> {
  return apiRequest<DiscoveredRolesResult>('/user/admin/account/roles', {
    method: 'POST',
    body: { principalArn },
  });
}

/**
 * Per-table deletion counts. `cleanupOrphanedData` settles its seven table
 * deletes independently and reports per-table `failures`, so a partial run
 * still answers 200 — this shape is the route's, not a simplification of it.
 */
interface OrphanedDeletedCounts {
  awsAccounts: number;
  roleConfigs: number;
  teamAccounts: number;
  spendAlerts: number;
  costData: number;
  resourceInventory: number;
  dataCollectionConfig: number;
}

interface CleanupOrphanedResult {
  deletedCounts: OrphanedDeletedCounts;
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

async function setRoleConfig(awsAccountId: string, roleName: string, config: RoleConfigOptions): Promise<void> {
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

/**
 * The alert as the route echoes it back. Only `id` is read; it is optional
 * because the response body is not validated, and a missing one is shown as
 * "unknown" rather than crashing the toast.
 */
interface CreatedSpendAlert {
  id?: string;
}

async function createSpendAlert(alert: SpendAlertInput): Promise<CreatedSpendAlert> {
  const data = await apiRequest<{ alert?: CreatedSpendAlert }>('/user/admin/costs/alerts', { method: 'POST', body: alert });
  return data.alert ?? {};
}

async function deleteSpendAlert(alertId: string): Promise<void> {
  await apiRequest<void>('/user/admin/costs/alerts', { method: 'DELETE', body: { alertId } });
}

async function cleanupOrphaned(): Promise<CleanupOrphanedResult> {
  return apiRequest<CleanupOrphanedResult>('/user/admin/maintenance/cleanup-orphaned', { method: 'POST' });
}

export type {
  ChainTestEntry,
  ChainTestResult,
  CleanupOrphanedResult,
  CreatedSpendAlert,
  DiscoveredRole,
  DiscoveredRolesResult,
  OrphanedDeletedCounts,
  RoleConfigOptions,
  SpendAlertInput,
  ValidatedIdentity,
};
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
