import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SetAccountNicknameRoute } from '@/endpoints/user/admin/account/nickname/PUT';
import { RemoveAccountNicknameRoute } from '@/endpoints/user/admin/account/nickname/DELETE';
import { ListAccountRolesRoute } from '@/endpoints/user/admin/account/roles/POST';
import { SetRoleConfigRoute } from '@/endpoints/user/admin/role/config/PUT';
import { DeleteRoleConfigRoute } from '@/endpoints/user/admin/role/config/DELETE';
import { AwsAccountsDAO } from '@aws-access-bridge/backend-data/dao/AwsAccountsDAO';
import { CredentialsDAO } from '@aws-access-bridge/backend-data/dao/CredentialsDAO';
import { RoleConfigsDAO } from '@aws-access-bridge/backend-data/dao/RoleConfigsDAO';
import { UserMetadataDAO } from '@aws-access-bridge/backend-data/dao/UserMetadataDAO';
import { AssumeRoleUtil } from '@aws-access-bridge/backend-services/aws/AssumeRoleUtil';
import { AwsApiUtil } from '@aws-access-bridge/backend-services/aws/AwsApiUtil';
import { createRouteContext } from '../helpers/route-context';

vi.mock('@aws-access-bridge/backend-data/dao/AwsAccountsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/CredentialsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/RoleConfigsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/UserMetadataDAO');
vi.mock('@aws-access-bridge/backend-services/aws/AssumeRoleUtil');
vi.mock('@aws-access-bridge/backend-services/aws/AwsApiUtil');

function adminEnv() {
  vi.mocked(UserMetadataDAO.prototype.isSuperAdmin).mockResolvedValue(true);
  return {
    AES_ENCRYPTION_KEY_SECRET: { get: vi.fn().mockResolvedValue('master-key') },
  };
}

describe('admin nickname routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PUT /user/admin/account/nickname sets nicknames', async () => {
    vi.mocked(AwsAccountsDAO.prototype.ensureAccountExists).mockResolvedValue(undefined);
    vi.mocked(AwsAccountsDAO.prototype.setAccountNickname).mockResolvedValue(undefined);
    const c = createRouteContext({
      method: 'PUT',
      body: { awsAccountId: '123456789012', nickname: 'prod' },
      env: adminEnv(),
    });
    await new SetAccountNicknameRoute({} as never).handle(c as never);
    expect(AwsAccountsDAO.prototype.setAccountNickname).toHaveBeenCalledWith('123456789012', 'prod');
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, nickname: 'prod' }));
  });

  it('PUT /user/admin/account/nickname rejects malformed ids', async () => {
    const c = createRouteContext({ method: 'PUT', body: { awsAccountId: 'abc', nickname: 'x' }, env: adminEnv() });
    await new SetAccountNicknameRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ Exception: expect.objectContaining({ Type: 'BadRequest' }) }), 400);
  });

  it('DELETE /user/admin/account/nickname removes nicknames', async () => {
    vi.mocked(AwsAccountsDAO.prototype.removeAccountNickname).mockResolvedValue(undefined);
    const c = createRouteContext({ method: 'DELETE', body: { awsAccountId: '123456789012' }, env: adminEnv() });
    await new RemoveAccountNicknameRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('admin roles discovery route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /user/admin/account/roles discovers roles through the chain', async () => {
    vi.mocked(CredentialsDAO.prototype.getCredentialChainByPrincipalArn).mockResolvedValue({
      principalArns: ['arn:aws:iam::123456789012:role/Dev', 'arn:aws:iam::123456789012:user/base'],
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      sessionToken: 'token',
    });
    vi.mocked(AssumeRoleUtil.assumeRole).mockResolvedValue({
      accessKeyId: 'ASIA',
      secretAccessKey: 'shh',
      sessionToken: 'tok',
      expiration: '2025-01-01T00:00:00Z',
    });
    vi.mocked(AwsApiUtil.listRoles).mockResolvedValue([{ roleName: 'Dev', arn: 'arn:aws:iam::123456789012:role/Dev', description: '' }]);
    const c = createRouteContext({
      method: 'POST',
      body: { principalArn: 'arn:aws:iam::123456789012:role/Dev' },
      env: adminEnv(),
    });
    await new ListAccountRolesRoute({} as never).handle(c as never);
    expect(AwsApiUtil.listRoles).toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ roles: expect.any(Array) }));
  });
});

describe('admin role config routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PUT /user/admin/role/config stores config', async () => {
    vi.mocked(AwsAccountsDAO.prototype.ensureAccountExists).mockResolvedValue(undefined);
    vi.mocked(RoleConfigsDAO.prototype.setRoleConfig).mockResolvedValue(undefined);
    const c = createRouteContext({
      method: 'PUT',
      body: { awsAccountId: '123456789012', roleName: 'Dev', destinationPath: '/ec2/home' },
      env: adminEnv(),
    });
    await new SetRoleConfigRoute({} as never).handle(c as never);
    expect(RoleConfigsDAO.prototype.setRoleConfig).toHaveBeenCalledWith('123456789012', 'Dev', '/ec2/home', undefined, undefined);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('DELETE /user/admin/role/config removes config', async () => {
    vi.mocked(RoleConfigsDAO.prototype.deleteRoleConfig).mockResolvedValue(undefined);
    const c = createRouteContext({
      method: 'DELETE',
      body: { awsAccountId: '123456789012', roleName: 'Dev' },
      env: adminEnv(),
    });
    await new DeleteRoleConfigRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
