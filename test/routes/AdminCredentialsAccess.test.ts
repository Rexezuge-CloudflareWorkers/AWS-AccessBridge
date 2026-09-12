import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StoreCredentialRoute } from '@/endpoints/user/admin/credentials/POST';
import { StoreCredentialRelationshipRoute } from '@/endpoints/user/admin/credentials/relationship/POST';
import { RemoveCredentialRelationshipRoute } from '@/endpoints/user/admin/credentials/relationship/DELETE';
import { ValidateCredentialsRoute } from '@/endpoints/user/admin/credentials/validate/POST';
import { TestCredentialChainRoute } from '@/endpoints/user/admin/credentials/test-chain/POST';
import { GrantAccessRoute } from '@/endpoints/user/admin/access/POST';
import { RevokeAccessRoute } from '@/endpoints/user/admin/access/DELETE';
import { CredentialsDAO } from '@aws-access-bridge/backend-data/dao/CredentialsDAO';
import { AssumableRolesDAO } from '@aws-access-bridge/backend-data/dao/AssumableRolesDAO';
import { AwsAccountsDAO } from '@aws-access-bridge/backend-data/dao/AwsAccountsDAO';
import { UserMetadataDAO } from '@aws-access-bridge/backend-data/dao/UserMetadataDAO';
import { StsService } from '@aws-access-bridge/backend-services/aws/sts';
import { createRouteContext } from '../helpers/route-context';

vi.mock('@aws-access-bridge/backend-data/dao/CredentialsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/AssumableRolesDAO');
vi.mock('@aws-access-bridge/backend-data/dao/AwsAccountsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/UserMetadataDAO');
vi.mock('@aws-access-bridge/backend-services/aws/sts');

function adminEnv() {
  vi.mocked(UserMetadataDAO.prototype.isSuperAdmin).mockResolvedValue(true);
  return {
    AES_ENCRYPTION_KEY_SECRET: { get: vi.fn().mockResolvedValue('master-key') },
  };
}

const USER_ARN = 'arn:aws:iam::123456789012:user/base';
const ROLE_ARN = 'arn:aws:iam::123456789012:role/Dev';

describe('admin credentials routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /user/admin/credentials stores credentials', async () => {
    vi.mocked(CredentialsDAO.prototype.storeCredential).mockResolvedValue(undefined);
    const c = createRouteContext({
      method: 'POST',
      body: { principalArn: USER_ARN, accessKeyId: 'AKIA', secretAccessKey: 'secret' },
      env: adminEnv(),
    });
    await new StoreCredentialRoute({} as never).handle(c as never);
    expect(CredentialsDAO.prototype.storeCredential).toHaveBeenCalledWith(USER_ARN, 'AKIA', 'secret', undefined);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('POST /user/admin/credentials/relationship validates ARNs', async () => {
    vi.mocked(CredentialsDAO.prototype.storeCredentialRelationship).mockResolvedValue(undefined);
    const c = createRouteContext({
      method: 'POST',
      body: { principalArn: ROLE_ARN, assumedBy: USER_ARN },
      env: adminEnv(),
    });
    await new StoreCredentialRelationshipRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    const bad = createRouteContext({ method: 'POST', body: { principalArn: 'nope', assumedBy: USER_ARN }, env: adminEnv() });
    await new StoreCredentialRelationshipRoute({} as never).handle(bad as never);
    expect(bad.json).toHaveBeenCalledWith(expect.objectContaining({ Exception: expect.objectContaining({ Type: 'BadRequest' }) }), 400);
  });

  it('DELETE /user/admin/credentials/relationship removes credentials', async () => {
    vi.mocked(CredentialsDAO.prototype.removeCredential).mockResolvedValue(undefined);
    const c = createRouteContext({ method: 'DELETE', body: { principalArn: USER_ARN }, env: adminEnv() });
    await new RemoveCredentialRelationshipRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('POST /user/admin/credentials/validate delegates to StsService', async () => {
    vi.mocked(StsService.prototype.validateCredentials).mockResolvedValue({ arn: USER_ARN, accountId: '123456789012', userId: 'AIDA' });
    const c = createRouteContext({
      method: 'POST',
      body: { accessKeyId: 'AKIA', secretAccessKey: 'secret' },
      env: adminEnv(),
    });
    await new ValidateCredentialsRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ valid: true, accountId: '123456789012' }));
  });

  it('POST /user/admin/credentials/test-chain walks the chain', async () => {
    vi.mocked(CredentialsDAO.prototype.getCredentialChainByPrincipalArn).mockResolvedValue({
      principalArns: [ROLE_ARN, USER_ARN],
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      sessionToken: 'token',
    });
    vi.mocked(StsService.prototype.assumeRole).mockResolvedValue({
      accessKeyId: 'ASIA',
      secretAccessKey: 'shh',
      sessionToken: 'tok',
      expiration: '2025-01-01T00:00:00Z',
    });
    const c = createRouteContext({ method: 'POST', body: { principalArn: ROLE_ARN }, env: adminEnv() });
    await new TestCredentialChainRoute({} as never).handle(c as never);
    expect(StsService.prototype.assumeRole).toHaveBeenCalledTimes(1);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ chain: expect.any(Array) }));
  });
});

describe('admin access routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /user/admin/access grants role access', async () => {
    vi.mocked(AwsAccountsDAO.prototype.ensureAccountExists).mockResolvedValue(undefined);
    vi.mocked(AssumableRolesDAO.prototype.grantUserAccessToRole).mockResolvedValue(undefined);
    const c = createRouteContext({
      method: 'POST',
      body: { awsAccountId: '123456789012', roleName: 'Dev', userEmail: 'dev@example.com' },
      env: adminEnv(),
    });
    await new GrantAccessRoute({} as never).handle(c as never);
    expect(AssumableRolesDAO.prototype.grantUserAccessToRole).toHaveBeenCalledWith('dev@example.com', '123456789012', 'Dev');
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('POST /user/admin/access rejects malformed account ids', async () => {
    const c = createRouteContext({
      method: 'POST',
      body: { awsAccountId: 'abc', roleName: 'Dev' },
      env: adminEnv(),
    });
    await new GrantAccessRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ Exception: expect.objectContaining({ Type: 'BadRequest' }) }), 400);
  });

  it('DELETE /user/admin/access revokes access', async () => {
    vi.mocked(AssumableRolesDAO.prototype.revokeUserAccessToRole).mockResolvedValue(undefined);
    const c = createRouteContext({
      method: 'DELETE',
      body: { awsAccountId: '123456789012', roleName: 'Dev' },
      env: adminEnv(),
    });
    await new RevokeAccessRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
