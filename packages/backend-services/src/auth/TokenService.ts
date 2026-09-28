import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { UserAccessTokenDAO } from '@aws-access-bridge/backend-data/dao';

import { BadRequestError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
import type { UserAccessTokenMetadata } from '@aws-access-bridge/shared/model/UserAccessToken';
import { TimestampUtil, UUIDUtil } from '@aws-access-bridge/shared/utils';
import type { ServiceEnv } from '../composition/ServiceEnv';
import { UserIdentityService, idOf } from '../identity/UserIdentityService';

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
   */
  public async authenticateWithPAT(token: string): Promise<string> {
    const dao: UserAccessTokenDAO = new UserAccessTokenDAO(this.env.AccessBridgeDB);
    const tokenData: UserAccessTokenMetadata | undefined = await dao.getByToken(token, true);
    if (tokenData) {
      await dao.updateLastUsedByToken(token);
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
    const account = await this.identity.resolveAccount(userEmail);
    // Quota applies to usable tokens only: expired rows are never cleaned up in
    // the background, so counting them would lock a user out permanently.
    const accountId: string | null = idOf(account);
    const activeTokenCount: number =
      accountId && account
        ? await dao.countActiveByUserId(accountId, account.anchorEmail)
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
    const expiresAt: number = TimestampUtil.addDays(TimestampUtil.getCurrentUnixTimestampInSeconds(), effectiveExpiryInDays);
    // The anchor goes in the `user_email` column because the foreign key on
    // that column is the one thing the schema cannot repoint.
    await dao.create(tokenId, account?.anchorEmail ?? userEmail, token, name, expiresAt, accountId);
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
    const account = await this.identity.resolveAccount(userEmail);
    await dao.delete(tokenId, account?.anchorEmail ?? userEmail, idOf(account));
  }
}
export { TokenService };
export type { CreatedToken, TokenServiceEnv };
