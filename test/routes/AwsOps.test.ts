import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssumeRoleRoute } from '@/endpoints/api/aws/assume-role/POST';
import { GenerateConsoleUrlRoute } from '@/endpoints/api/aws/console/POST';
import { FederateRoute } from '@/endpoints/api/aws/federate/GET';
import { AssumableRolesDAO } from '@aws-access-bridge/backend-data/dao/AssumableRolesDAO';
import { CredentialsCacheDAO } from '@aws-access-bridge/backend-data/dao/CredentialsCacheDAO';
import { UserMetadataDAO } from '@aws-access-bridge/backend-data/dao/UserMetadataDAO';
import { EnhancedCredentialsDAO } from '@aws-access-bridge/backend-data/dao/EnhancedCredentialsDAO';
import { RoleConfigsDAO } from '@aws-access-bridge/backend-data/dao/RoleConfigsDAO';
import { AssumeRoleUtil } from '@aws-access-bridge/backend-services/aws/AssumeRoleUtil';
import { AwsConsoleUtil } from '@aws-access-bridge/backend-services/aws/AwsConsoleUtil';
import { InternalRequestHelper } from '@aws-access-bridge/backend-services/aws/InternalRequestHelper';
import { createRouteContext } from '../helpers/route-context';

vi.mock('@aws-access-bridge/backend-data/dao/AssumableRolesDAO');
vi.mock('@aws-access-bridge/backend-data/dao/CredentialsCacheDAO');
vi.mock('@aws-access-bridge/backend-data/dao/UserMetadataDAO');
vi.mock('@aws-access-bridge/backend-data/dao/EnhancedCredentialsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/RoleConfigsDAO');
vi.mock('@aws-access-bridge/backend-services/aws/AssumeRoleUtil');
vi.mock('@aws-access-bridge/backend-services/aws/AwsConsoleUtil', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@aws-access-bridge/backend-services/aws/AwsConsoleUtil')>();
  return {
    ...mod,
    AwsConsoleUtil: class extends mod.AwsConsoleUtil {
      static override getSigninToken = vi.fn();
    },
  };
});
vi.mock('@aws-access-bridge/backend-services/aws/InternalRequestHelper');

const PRINCIPAL = 'arn:aws:iam::123456789012:role/Dev';

function secretsEnv() {
  return {
    AccessBridgeKV: {},
    AES_ENCRYPTION_KEY_SECRET: { get: vi.fn().mockResolvedValue('master-key') },
    INTERNAL_HMAC_SECRET: { get: vi.fn().mockResolvedValue('hmac-secret') },
    SELF: {},
  };
}

describe('AssumeRoleRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assumes a single-hop chain and returns credentials', async () => {
    vi.mocked(AssumableRolesDAO.prototype.verifyUserHasAccessToRole).mockResolvedValue(undefined);
    vi.mocked(RoleConfigsDAO.prototype.getRoleConfig).mockResolvedValue(undefined);
    vi.mocked(EnhancedCredentialsDAO.prototype.getCredentialChainToFirstCachedPrincipal).mockResolvedValue({
      principalArns: [PRINCIPAL, 'arn:aws:iam::123456789012:user/base'],
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      sessionToken: 'token',
    });
    vi.mocked(UserMetadataDAO.prototype.getOrCreateFederationUsername).mockResolvedValue('federated-user');
    vi.mocked(CredentialsCacheDAO.prototype.getCachedCredential).mockResolvedValue(undefined);
    vi.mocked(AssumeRoleUtil.assumeRole).mockResolvedValue({
      accessKeyId: 'ASIA',
      secretAccessKey: 'shh',
      sessionToken: 'tok',
      expiration: '2025-01-01T00:00:00Z',
    });
    const c = createRouteContext({ method: 'POST', body: { principalArn: PRINCIPAL }, env: secretsEnv() });
    await new AssumeRoleRoute({} as never).handle(c as never);
    expect(AssumeRoleUtil.assumeRole).toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ accessKeyId: 'ASIA', sessionToken: 'tok' }));
  });

  it('rejects missing principal ARNs', async () => {
    const c = createRouteContext({ method: 'POST', body: {}, env: secretsEnv() });
    await new AssumeRoleRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ Exception: expect.objectContaining({ Type: 'BadRequest' }) }), 400);
  });
});

describe('GenerateConsoleUrlRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a console login URL with region', async () => {
    vi.mocked(AwsConsoleUtil.getSigninToken).mockResolvedValue('signin-token');
    const c = createRouteContext({
      method: 'POST',
      body: { accessKeyId: 'AKIA', secretAccessKey: 's', destinationRegion: 'eu-west-1' },
      env: secretsEnv(),
    });
    await new GenerateConsoleUrlRoute({} as never).handle(c as never);
    expect(AwsConsoleUtil.getSigninToken).toHaveBeenCalledWith('AKIA', 's', undefined);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('signin.aws.amazon.com') }));
  });
});

describe('FederateRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fans out to assume-role and console and redirects', async () => {
    vi.mocked(RoleConfigsDAO.prototype.getRoleConfig).mockResolvedValue(undefined);
    const assumeResponse = { ok: true, json: async () => ({ accessKeyId: 'A', secretAccessKey: 'S', sessionToken: 'T' }) };
    const consoleResponse = { ok: true, json: async () => ({ url: 'https://signin.aws.amazon.com/login?x=1' }) };
    vi.mocked(InternalRequestHelper.prototype.makeRequest)
      .mockResolvedValueOnce(assumeResponse as Response)
      .mockResolvedValueOnce(consoleResponse as Response);
    const c = createRouteContext({
      url: 'https://example.com/user/aws/federate?awsAccountId=123456789012&role=Dev',
      env: secretsEnv(),
    });
    await new FederateRoute({} as never).handle(c as never);
    expect(InternalRequestHelper.prototype.makeRequest).toHaveBeenCalledTimes(2);
    expect(c.status).toHaveBeenCalledWith(302);
    expect(c.header).toHaveBeenCalledWith('Location', 'https://signin.aws.amazon.com/login?x=1');
  });

  it('rejects missing query parameters', async () => {
    const c = createRouteContext({ url: 'https://example.com/user/aws/federate', env: secretsEnv() });
    await new FederateRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ Exception: expect.objectContaining({ Type: 'BadRequest' }) }), 400);
  });
});
