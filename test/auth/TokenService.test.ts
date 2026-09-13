import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenService } from '@aws-access-bridge/backend-services/auth/TokenService';
import { UserAccessTokenDAO } from '@aws-access-bridge/backend-data/dao/UserAccessTokenDAO';
import { BadRequestError, UnauthorizedError } from '@aws-access-bridge/backend-errors';

vi.mock('@aws-access-bridge/backend-data/dao/UserAccessTokenDAO');

function env() {
  return { AccessBridgeDB: {}, MAX_TOKENS_PER_USER: '2', MAX_TOKEN_EXPIRY_DAYS: '30' } as never;
}

describe('TokenService lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authenticates valid PATs and touches last-used', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.getByToken).mockResolvedValue({ userEmail: 'user@example.com' } as never);
    vi.mocked(UserAccessTokenDAO.prototype.updateLastUsedByToken).mockResolvedValue(undefined);
    await expect(new TokenService(env()).authenticateWithPAT('pat')).resolves.toBe('user@example.com');
    expect(UserAccessTokenDAO.prototype.updateLastUsedByToken).toHaveBeenCalledWith('pat');
  });

  it('rejects unknown or expired PATs with 401', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.getByToken).mockResolvedValue(undefined);
    await expect(new TokenService(env()).authenticateWithPAT('bad')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('enforces MAX_TOKENS_PER_USER and MAX_TOKEN_EXPIRY_DAYS', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.getByUserEmail).mockResolvedValue([{}, {}] as never);
    await expect(new TokenService(env()).createToken('u@e.com', 'n')).rejects.toBeInstanceOf(BadRequestError);

    vi.mocked(UserAccessTokenDAO.prototype.getByUserEmail).mockResolvedValue([]);
    await expect(new TokenService(env()).createToken('u@e.com', 'n', 90)).rejects.toBeInstanceOf(BadRequestError);

    vi.mocked(UserAccessTokenDAO.prototype.create).mockResolvedValue(undefined);
    const created = await new TokenService(env()).createToken('u@e.com', 'n', 7);
    expect(created.token).toHaveLength(64);
    expect(UserAccessTokenDAO.prototype.create).toHaveBeenCalledOnce();
  });

  it('lists and revokes tokens', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.getByUserEmail).mockResolvedValue([{ tokenId: 't1' }] as never);
    await expect(new TokenService(env()).listTokens('u@e.com')).resolves.toHaveLength(1);
    vi.mocked(UserAccessTokenDAO.prototype.delete).mockResolvedValue(undefined);
    await new TokenService(env()).deleteToken('t1', 'u@e.com');
    expect(UserAccessTokenDAO.prototype.delete).toHaveBeenCalledWith('t1', 'u@e.com');
  });
});
