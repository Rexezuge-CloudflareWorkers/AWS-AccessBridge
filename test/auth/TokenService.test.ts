import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenService } from '@aws-access-bridge/backend-services/auth/TokenService';
import { UserAccessTokenDAO } from '@aws-access-bridge/backend-data/dao/UserAccessTokenDAO';
import type { AccountIdentity, UserIdentityEnv } from '@aws-access-bridge/backend-services/identity/UserIdentityService';
import { BadRequestError, DatabaseError, UnauthorizedError } from '@aws-access-bridge/backend-errors';

vi.mock('@aws-access-bridge/backend-data/dao/UserAccessTokenDAO');

const ACCOUNT: AccountIdentity = { id: 'usr_abc', email: 'u@e.com', anchorEmail: 'old@e.com' };

/**
 * A stub identity service. Every method returns a promise, unlike an unmocked
 * DAO — the point being to pin the *account* a method is acting for, so the
 * assertions below can tell an id-keyed read from an address-keyed one.
 */
function identity(account: AccountIdentity | null = ACCOUNT) {
  return {
    resolveAccount: vi.fn().mockResolvedValue(account),
    resolveUserId: vi.fn().mockResolvedValue(account?.id ?? null),
    resolveAccountById: vi.fn().mockResolvedValue(account),
  } as unknown as UserIdentityService & { resolveAccount: ReturnType<typeof vi.fn> };
}

function env(): UserIdentityEnv {
  return { AccessBridgeDB: {}, MAX_TOKENS_PER_USER: '2', MAX_TOKEN_EXPIRY_DAYS: '30' } as never;
}

describe('TokenService lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authenticates valid PATs and touches last-used', async () => {
    // No id on the row (pre-0032): the stored address is the only answer.
    vi.mocked(UserAccessTokenDAO.prototype.getByToken).mockResolvedValue({ userEmail: 'user@example.com' } as never);
    vi.mocked(UserAccessTokenDAO.prototype.updateLastUsedByToken).mockResolvedValue(undefined);
    await expect(new TokenService(env(), identity(null)).authenticateWithPAT('pat')).resolves.toBe('user@example.com');
    expect(UserAccessTokenDAO.prototype.updateLastUsedByToken).toHaveBeenCalledWith('pat');
  });

  it('authenticates even when the last-used write fails', async () => {
    // `updateLastUsedByToken` throws `DatabaseError` on `!result.success`, and it
    // used to be awaited on the auth critical path — so a write-side blip turned a
    // perfectly valid PAT into a 500.
    vi.mocked(UserAccessTokenDAO.prototype.getByToken).mockResolvedValue({ userEmail: 'user@example.com' } as never);
    vi.mocked(UserAccessTokenDAO.prototype.updateLastUsedByToken).mockRejectedValue(new DatabaseError('D1 is busy'));
    await expect(new TokenService(env(), identity(null)).authenticateWithPAT('pat')).resolves.toBe('user@example.com');
  });

  it('hands the last-used write to the caller to detach', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.getByToken).mockResolvedValue({ userEmail: 'user@example.com' } as never);
    vi.mocked(UserAccessTokenDAO.prototype.updateLastUsedByToken).mockResolvedValue(undefined);
    const defer = vi.fn();
    await new TokenService(env(), identity(null)).authenticateWithPAT('pat', defer);
    // The middleware passes `ctx.waitUntil`, so the write leaves the response path.
    expect(defer).toHaveBeenCalledOnce();
    expect(defer.mock.calls[0]?.[0]).toBeInstanceOf(Promise);
  });

  // The whole point of stamping `user_id` on tokens: without this, a token
  // minted before an address change keeps authenticating as the old address.
  it('reports the owner current address for a token carrying an id', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.getByToken).mockResolvedValue({
      userEmail: 'old@e.com',
      userId: 'usr_abc',
    } as never);
    vi.mocked(UserAccessTokenDAO.prototype.updateLastUsedByToken).mockResolvedValue(undefined);
    await expect(new TokenService(env(), identity(ACCOUNT)).authenticateWithPAT('pat')).resolves.toBe('u@e.com');
  });

  it('rejects unknown or expired PATs with 401', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.getByToken).mockResolvedValue(undefined);
    await expect(new TokenService(env(), identity(null)).authenticateWithPAT('bad')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('enforces MAX_TOKENS_PER_USER and MAX_TOKEN_EXPIRY_DAYS', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.countActiveByUserId).mockResolvedValue(2);
    await expect(new TokenService(env(), identity()).createToken('u@e.com', 'n')).rejects.toBeInstanceOf(BadRequestError);

    vi.mocked(UserAccessTokenDAO.prototype.countActiveByUserId).mockResolvedValue(0);
    await expect(new TokenService(env(), identity()).createToken('u@e.com', 'n', 90)).rejects.toBeInstanceOf(BadRequestError);

    vi.mocked(UserAccessTokenDAO.prototype.create).mockResolvedValue(undefined);
    const created = await new TokenService(env(), identity()).createToken('u@e.com', 'n', 7);
    expect(created.token).toHaveLength(64);
    expect(UserAccessTokenDAO.prototype.create).toHaveBeenCalledOnce();
  });

  it('writes the anchor into the foreign-keyed column and the id alongside', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.countActiveByUserId).mockResolvedValue(0);
    vi.mocked(UserAccessTokenDAO.prototype.create).mockResolvedValue(undefined);
    await new TokenService(env(), identity()).createToken('u@e.com', 'n', 7);
    // `old@e.com` is the anchor: `user_access_tokens.user_email` still carries a
    // live `ON DELETE CASCADE` foreign key to it.
    expect(UserAccessTokenDAO.prototype.create).toHaveBeenCalledWith(
      expect.any(String),
      'old@e.com',
      expect.any(String),
      'n',
      expect.any(Number),
      'usr_abc',
    );
  });

  it('counts the quota by id, and falls back to the address when unresolvable', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.countActiveByUserId).mockResolvedValue(0);
    vi.mocked(UserAccessTokenDAO.prototype.create).mockResolvedValue(undefined);
    await new TokenService(env(), identity()).createToken('u@e.com', 'n', 7);
    expect(UserAccessTokenDAO.prototype.countActiveByUserId).toHaveBeenCalledWith('usr_abc', 'old@e.com');

    vi.clearAllMocks();
    vi.mocked(UserAccessTokenDAO.prototype.countActiveByUserEmail).mockResolvedValue(0);
    vi.mocked(UserAccessTokenDAO.prototype.create).mockResolvedValue(undefined);
    await new TokenService(env(), identity(null)).createToken('u@e.com', 'n', 7);
    expect(UserAccessTokenDAO.prototype.countActiveByUserEmail).toHaveBeenCalledWith('u@e.com');
  });

  it('counts only unexpired tokens against the quota', async () => {
    // Expired rows are never pruned in the background, so counting them would
    // lock a user out of ever minting another token.
    vi.mocked(UserAccessTokenDAO.prototype.getByUserId).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        tokenId: `t${i}`,
        userEmail: 'u',
        name: 'n',
        createdAt: 1,
        expiresAt: 1,
        lastUsedAt: undefined,
      })),
    );
    vi.mocked(UserAccessTokenDAO.prototype.countActiveByUserId).mockResolvedValue(0);
    vi.mocked(UserAccessTokenDAO.prototype.create).mockResolvedValue(undefined);
    await expect(new TokenService(env(), identity()).createToken('u@e.com', 'n', 7)).resolves.toMatchObject({ name: 'n' });
  });

  it('lists and revokes tokens', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.getByUserId).mockResolvedValue([{ tokenId: 't1' }] as never);
    await expect(new TokenService(env(), identity()).listTokens('u@e.com')).resolves.toHaveLength(1);
    vi.mocked(UserAccessTokenDAO.prototype.delete).mockResolvedValue(undefined);
    await new TokenService(env(), identity()).deleteToken('t1', 'u@e.com');
    expect(UserAccessTokenDAO.prototype.delete).toHaveBeenCalledWith('t1', 'old@e.com', 'usr_abc');
  });

  // The list is shown to the user, so it must not report the anchor they no
  // longer sign in with.
  it('lists tokens under the address the account signs in with', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.getByUserId).mockResolvedValue([
      { tokenId: 't1', userEmail: 'old@e.com' } as never,
    ]);
    const listed = await new TokenService(env(), identity()).listTokens('u@e.com');
    expect(listed[0]?.userEmail).toBe('u@e.com');
  });
});
