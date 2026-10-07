import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CredentialChainService } from '@aws-access-bridge/backend-services/credential/CredentialChainService';
import { CredentialStoreService } from '@aws-access-bridge/backend-services/credential/CredentialStoreService';
import { CredentialsDAO } from '@aws-access-bridge/backend-data/dao/CredentialsDAO';
import { CredentialsCacheDAO } from '@aws-access-bridge/backend-data/dao/CredentialsCacheDAO';
import { StsService } from '@aws-access-bridge/backend-services/aws/sts';
import { BadRequestError, ForbiddenError, InternalServerError } from '@aws-access-bridge/backend-errors';

vi.mock('@aws-access-bridge/backend-data/dao/CredentialsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/CredentialsCacheDAO');
vi.mock('@aws-access-bridge/backend-services/aws/sts');

const BASE = 'arn:aws:iam::123456789012:user/base';
const MID = 'arn:aws:iam::123456789012:role/Mid';
const LEAF = 'arn:aws:iam::123456789012:role/Leaf';

function env() {
  return {
    AccessBridgeDB: {},
    AccessBridgeKV: {},
    CREDENTIAL_ENCRYPTION_KEY_SECRET: { get: vi.fn().mockResolvedValue('master-key') },
    CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET: { get: vi.fn().mockResolvedValue('master-key') },
    PRINCIPAL_TRUST_CHAIN_LIMIT: '3',
  } as never;
}

describe('CredentialChainService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('short-circuits at the first cached principal', async () => {
    vi.mocked(CredentialsDAO.prototype.getCredentialByPrincipalArn).mockImplementation(async (arn: string) =>
      arn === LEAF ? ({ assumedBy: MID } as never) : ({ assumedBy: BASE } as never),
    );
    vi.mocked(CredentialsCacheDAO.prototype.getCachedCredential).mockImplementation(async (arn: string) =>
      arn === MID ? ({ accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: 'ST' } as never) : undefined,
    );
    const chain = await new CredentialChainService(env()).getCredentialChainToFirstCachedPrincipal(LEAF);
    expect(chain.principalArns).toEqual([LEAF, MID]);
    expect(chain.accessKeyId).toBe('AK');
  });

  it('walks multi-hop chains via the Template walker', async () => {
    vi.mocked(CredentialsDAO.prototype.getCredentialChainByPrincipalArn).mockResolvedValue({
      principalArns: [LEAF, MID, BASE],
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      sessionToken: 'ST',
    });
    vi.mocked(StsService.prototype.assumeRole)
      .mockResolvedValueOnce({ accessKeyId: 'A1', secretAccessKey: 'S1', sessionToken: 'T1', expiration: 'e' })
      .mockResolvedValueOnce({ accessKeyId: 'A2', secretAccessKey: 'S2', sessionToken: 'T2', expiration: 'e' });
    const { chain, credentials } = await new CredentialChainService(env()).resolveLeafCredentials(LEAF, 'test');
    expect(chain.principalArns).toHaveLength(3);
    expect(credentials.accessKeyId).toBe('A2');
    expect(StsService.prototype.assumeRole).toHaveBeenCalledTimes(2);
  });

  it('reports per-hop test results and stops after failure', async () => {
    vi.mocked(CredentialsDAO.prototype.getCredentialChainByPrincipalArn).mockResolvedValue({
      principalArns: [LEAF, BASE],
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      sessionToken: 'ST',
    });
    vi.mocked(StsService.prototype.assumeRole).mockRejectedValue(new Error('denied'));
    const result = await new CredentialChainService(env()).testChain(LEAF);
    expect(result.success).toBe(false);
    expect(result.chain[0]).toEqual({ arn: BASE, status: 'ok (base credentials)' });
    expect(result.chain[1].status).toContain('denied');
  });

  it('rejects retrievable long-term credentials and invalid chains', async () => {
    const svc = new CredentialChainService(env());
    vi.mocked(CredentialsDAO.prototype.getCredentialByPrincipalArn).mockResolvedValue({
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
    } as never);
    vi.mocked(CredentialsCacheDAO.prototype.getCachedCredential).mockResolvedValue(undefined);
    await expect(svc.getCredentialChainToFirstCachedPrincipal(BASE)).rejects.toBeInstanceOf(ForbiddenError);

    vi.mocked(CredentialsDAO.prototype.getCredentialByPrincipalArn).mockResolvedValue({} as never);
    await expect(svc.getCredentialChainToFirstCachedPrincipal(BASE)).rejects.toBeInstanceOf(InternalServerError);
  });

  it('throws without a credential cache KV binding', async () => {
    // The key resolves, but the cache namespace does not exist — narrowing it to
    // undefined would fail much later inside STS assume-role with a confusing error.
    await expect(
      new CredentialChainService({
        AccessBridgeDB: {},
        CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET: { get: async () => 'k' },
      } as never).createCacheDAO(),
    ).rejects.toBeInstanceOf(InternalServerError);
  });

  it('throws when no encryption key is configured at all', async () => {
    // The feature key is required; there is no fallback to read instead.
    await expect(new CredentialChainService({ AccessBridgeDB: {} } as never).createCredentialsDAO()).rejects.toBeInstanceOf(
      InternalServerError,
    );
  });
});

describe('CredentialStoreService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates ARN shapes on relationship writes', async () => {
    const svc = new CredentialStoreService(env());
    await expect(svc.storeCredentialRelationship('nope', MID)).rejects.toBeInstanceOf(BadRequestError);
    await expect(svc.storeCredentialRelationship(MID, 'nope')).rejects.toBeInstanceOf(BadRequestError);
    await expect(svc.removeCredential('')).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects a test-chain request with no principal ARN', async () => {
    // The guard moved here from the deleted `CredentialService` facade, which is
    // where it used to live.
    await expect(new CredentialChainService(env()).testChain('')).rejects.toBeInstanceOf(BadRequestError);
  });

  it('maps STS validation failures to BadRequest', async () => {
    const svc = new CredentialStoreService(env());
    vi.mocked(StsService.prototype.validateCredentials).mockRejectedValue(new Error('aws down'));
    await expect(svc.validateCredentials('AK', 'SK')).rejects.toBeInstanceOf(BadRequestError);
    vi.mocked(StsService.prototype.validateCredentials).mockResolvedValue({ arn: BASE, accountId: '1', userId: 'u' });
    await expect(svc.validateCredentials('AK', 'SK')).resolves.toEqual({ arn: BASE, accountId: '1', userId: 'u' });
  });
});
