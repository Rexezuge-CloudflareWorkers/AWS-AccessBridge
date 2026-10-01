import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssumeRoleService } from '@aws-access-bridge/backend-services/aws/assume-role/AssumeRoleService';
import { StsService } from '@aws-access-bridge/backend-services/aws/sts';
import { CredentialsCacheDAO } from '@aws-access-bridge/backend-data/dao/CredentialsCacheDAO';
import type { CredentialChain } from '@aws-access-bridge/shared/model';

vi.mock('@aws-access-bridge/backend-services/aws/sts');
vi.mock('@aws-access-bridge/backend-data/dao/CredentialsCacheDAO');

const BASE = 'arn:aws:iam::123456789012:user/base';
const MID = 'arn:aws:iam::123456789012:role/Mid';
const TARGET = 'arn:aws:iam::123456789012:role/Dev';

function db(): never {
  const chain = { bind: () => chain, run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) };
  return { prepare: () => chain } as never;
}

/** target -> Mid -> base. Only `Mid` is an intermediate the cache is allowed to hold. */
const CHAIN: CredentialChain = {
  principalArns: [TARGET, MID, BASE],
  accessKeyId: 'AKIA',
  secretAccessKey: 'secret',
};

describe('AssumeRoleService.assumeRoleChain cache entries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(CredentialsCacheDAO.prototype.storeCachedCredential).mockResolvedValue(undefined);
  });

  function service(): AssumeRoleService {
    return new AssumeRoleService({ AccessBridgeDB: db(), AccessBridgeKV: {} } as never);
  }

  /**
   * `sessionToken!` sat inside the cache write. An STS response carrying an
   * expiration but no session token is not a usable credential, and the cache read
   * path short-circuits chain resolution on a hit — so the entry would have been
   * written, read straight back, and then handed to STS as an unauthenticated
   * request. Skipping the write just means the next walk re-derives the hop.
   */
  it('does not cache a hop whose credentials carry no session token', async () => {
    vi.mocked(StsService.prototype.assumeRole).mockResolvedValue({
      accessKeyId: 'ASIA',
      secretAccessKey: 'shh',
      // No sessionToken, but a valid expiration.
      expiration: '2099-01-01T00:00:00Z',
    } as never);

    await service().assumeRoleChain(new CredentialsCacheDAO({} as never), CHAIN, 1, CHAIN as never, 'FEDERATED');

    expect(CredentialsCacheDAO.prototype.storeCachedCredential).not.toHaveBeenCalled();
  });

  it('caches a hop that has both an expiration and a session token', async () => {
    vi.mocked(StsService.prototype.assumeRole).mockResolvedValue({
      accessKeyId: 'ASIA',
      secretAccessKey: 'shh',
      sessionToken: 'tok',
      expiration: '2099-01-01T00:00:00Z',
    } as never);

    await service().assumeRoleChain(new CredentialsCacheDAO({} as never), CHAIN, 1, CHAIN as never, 'FEDERATED');

    expect(CredentialsCacheDAO.prototype.storeCachedCredential).toHaveBeenCalledWith(
      expect.objectContaining({ principalArn: MID, sessionToken: 'tok' }),
    );
  });

  it('skips a hop whose credentials have a session token but no expiration', async () => {
    // Nothing to compute the KV TTL from, and an entry with no expiry would never
    // be evicted.
    vi.mocked(StsService.prototype.assumeRole).mockResolvedValue({
      accessKeyId: 'ASIA',
      secretAccessKey: 'shh',
      sessionToken: 'tok',
    } as never);

    await service().assumeRoleChain(new CredentialsCacheDAO({} as never), CHAIN, 1, CHAIN as never, 'FEDERATED');

    expect(CredentialsCacheDAO.prototype.storeCachedCredential).not.toHaveBeenCalled();
  });
});
