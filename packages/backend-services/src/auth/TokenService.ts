import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { UserAccessTokenDAO } from '@aws-access-bridge/backend-data/dao';

import { BadRequestError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
import type { UserAccessTokenMetadata } from '@aws-access-bridge/shared/model/UserAccessToken';
import { TimestampUtil, TokenHashUtil, UUIDUtil, log } from '@aws-access-bridge/shared/utils';
import type { ServiceEnv } from '../composition/ServiceEnv';
import { UserIdentityService } from '../identity/UserIdentityService';
import { resolveOwner } from '../identity/resolveOwner';

type TokenServiceEnv = ServiceEnv;

interface CreatedToken {
  tokenId: string;
  token: string;
  name: string;
  expiresAt: number;
}

class TokenService {
  constructor(
    private readonly env: TokenServiceEnv,
    private readonly identity: UserIdentityService = new UserIdentityService(env),
  ) {}

  /**
   * Resolve a token to the address its owner signs in with TODAY.
   *
   * A token's stored `user_email` is the account's frozen anchor, so returning
   * it directly would leave a token minted before an address change
   * authenticating as the old address indefinitely. When the row carries a
   * `user_id`, the owner's current address is read from the account; a token
   * with no id (written before 0032, or for an account the backfill could not
   * attribute) falls back to the stored address.
   *
   * `defer` receives work that should not delay or fail the response. The
   * last-used stamp is a D1 write on the critical path of every programmatic
   * call, and `updateLastUsedByToken` throws on failure — so awaiting it meant a
   * write-side blip turned a perfectly valid token into a 500. Best-effort by
   * nature: a missing timestamp costs a stale "last used" display, nothing more.
   */
  public async authenticateWithPAT(token: string, defer?: (work: Promise<unknown>) => void): Promise<string> {
    const dao: UserAccessTokenDAO = new UserAccessTokenDAO(this.env.AccessBridgeDB);
    const tokenHash: string = await TokenHashUtil.sha256Hex(token);
    const tokenData: UserAccessTokenMetadata | undefined = await dao.getByTokenHash(tokenHash, true);
    if (tokenData) {
      const stampLastUsed = dao.updateLastUsedByTokenHash(tokenHash);
      if (defer) {
        defer(stampLastUsed);
      } else {
        await stampLastUsed.catch((error: unknown) => {
          log.error('Failed to update token last-used timestamp', { error });
        });
      }
      if (tokenData.userId) {
        const account = await this.identity.resolveAccountById(tokenData.userId);
        if (account?.email) return account.email;
      }
      return tokenData.userEmail;
    }
    throw new UnauthorizedError('Your access could not be authorized because your personal access token is invalid or has expired.');
  }

  public async createToken(userEmail: string, name: string, expiresInDays?: number): Promise<CreatedToken> {
    const dao: UserAccessTokenDAO = new UserAccessTokenDAO(this.env.AccessBridgeDB);
    const maxTokens: number = ConfigurationManager.token.getMaxPerUser(this.env);
    const maxExpiryInDays: number = ConfigurationManager.token.getMaxExpiryDays(this.env);
    const owner = await resolveOwner(this.identity, userEmail);
    // Quota applies to usable tokens only: expired rows are never cleaned up in
    // the background, so counting them would lock a user out permanently.
    const activeTokenCount: number = owner.userId
      ? await dao.countActiveByUserId(owner.userId, owner.anchorEmail)
      : await dao.countActiveByUserEmail(userEmail);
    if (activeTokenCount >= maxTokens) {
      throw new BadRequestError(`Maximum ${maxTokens} tokens allowed per user`);
    }
    const effectiveExpiryInDays: number = expiresInDays || maxExpiryInDays;
    if (effectiveExpiryInDays > maxExpiryInDays) {
      throw new BadRequestError(`Token expiry cannot exceed ${maxExpiryInDays} days`);
    }
    const tokenId: string = UUIDUtil.getRandomUUID();
    const token: string = UUIDUtil.getRandomUUIDNoDash() + UUIDUtil.getRandomUUIDNoDash();
    const tokenHash: string = await TokenHashUtil.sha256Hex(token);
    const expiresAt: number = TimestampUtil.addDays(TimestampUtil.getCurrentUnixTimestampInSeconds(), effectiveExpiryInDays);
    // The anchor goes in the `user_email` column because the foreign key on
    // that column is the one thing the schema cannot repoint.
    // Only the digest is stored; the plaintext leaves this function exactly
    // once, in the response, and is never persisted.
    await dao.create(tokenId, owner.anchorEmail, tokenHash, name, expiresAt, owner.userId);
    return { tokenId, token, name, expiresAt };
  }

  public async listTokens(userEmail: string): Promise<UserAccessTokenMetadata[]> {
    const dao: UserAccessTokenDAO = new UserAccessTokenDAO(this.env.AccessBridgeDB);
    const account = await this.identity.resolveAccount(userEmail);
    if (!account) return dao.getByUserEmail(userEmail);
    const tokens = await dao.getByUserId(account.id, account.anchorEmail);
    // Report the address the account signs in with, not the token's anchor.
    return tokens.map((token) => ({ ...token, userEmail: account.email }));
  }

  public async deleteToken(tokenId: string, userEmail: string): Promise<void> {
    const dao: UserAccessTokenDAO = new UserAccessTokenDAO(this.env.AccessBridgeDB);
    const owner = await resolveOwner(this.identity, userEmail);
    await dao.delete(tokenId, owner.anchorEmail, owner.userId);
  }
}
export { TokenService };
export type { CreatedToken, TokenServiceEnv };
