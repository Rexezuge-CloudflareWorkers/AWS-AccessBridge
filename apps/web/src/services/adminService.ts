import { apiRequest } from '../lib/api';

/**
 * Admin domain service (vertical slice). Previously 7 `admin/*Tab.tsx`
 * files + `OnboardingWizard` called `apiFetch`/`apiCall` directly (2–3
 * calls each, untyped `Record`). All admin mutations go through here
 * (typed, thrown-`ApiError`).
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

async function grantAccess(userEmail: string, awsAccountId: string, roleName: string): Promise<void> {
  await apiRequest<void>('/user/admin/access', { method: 'POST', body: { userEmail, awsAccountId, roleName } });
}

async function revokeAccess(userEmail: string, awsAccountId: string, roleName: string): Promise<void> {
  await apiRequest<void>('/user/admin/access', { method: 'DELETE', body: { userEmail, awsAccountId, roleName } });
}

async function setRoleConfig(awsAccountId: string, roleName: string, config: Record<string, unknown>): Promise<void> {
  await apiRequest<void>('/user/admin/role/config', { method: 'PUT', body: { awsAccountId, roleName, ...config } });
}

async function deleteRoleConfig(awsAccountId: string, roleName: string): Promise<void> {
  await apiRequest<void>('/user/admin/role/config', { method: 'DELETE', body: { awsAccountId, roleName } });
}

async function enableDataCollection(principalArn: string, collectionType: string): Promise<void> {
  await apiRequest<void>('/user/admin/collection/config', { method: 'POST', body: { principalArn, collectionType } });
}

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

async function cleanupOrphaned(): Promise<{ deleted: number }> {
  return apiRequest<{ deleted: number }>('/user/admin/maintenance/cleanup-orphaned', { method: 'POST' });
}

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
