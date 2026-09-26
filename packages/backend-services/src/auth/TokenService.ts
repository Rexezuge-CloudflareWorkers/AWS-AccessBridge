import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { UserAccessTokenDAO } from '@aws-access-bridge/backend-data/dao';

import { BadRequestError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
import type { UserAccessTokenMetadata } from '@aws-access-bridge/shared/model/UserAccessToken';
import { TimestampUtil, UUIDUtil } from '@aws-access-bridge/shared/utils';
import type { ServiceEnv } from '../composition/ServiceEnv';

type TokenServiceEnv = ServiceEnv;

interface CreatedToken {
  tokenId: string;
  token: string;
  name: string;
  expiresAt: number;
}

class TokenService {
  constructor(private readonly env: TokenServiceEnv) {}

  public async authenticateWithPAT(token: string): Promise<string> {
    const dao: UserAccessTokenDAO = new UserAccessTokenDAO(this.env.AccessBridgeDB);
    const tokenData: UserAccessTokenMetadata | undefined = await dao.getByToken(token, true);
    if (tokenData) {
      await dao.updateLastUsedByToken(token);
      return tokenData.userEmail;
    }
    throw new UnauthorizedError('Your access could not be authorized because your personal access token is invalid or has expired.');
  }

  public async createToken(userEmail: string, name: string, expiresInDays?: number): Promise<CreatedToken> {
    const dao: UserAccessTokenDAO = new UserAccessTokenDAO(this.env.AccessBridgeDB);
    const maxTokens: number = ConfigurationManager.token.getMaxPerUser(this.env);
    const maxExpiryInDays: number = ConfigurationManager.token.getMaxExpiryDays(this.env);
    // Quota applies to usable tokens only: expired rows are never cleaned up in
    // the background, so counting them would lock a user out permanently.
    const activeTokenCount: number = await dao.countActiveByUserEmail(userEmail);
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
    await dao.create(tokenId, userEmail, token, name, expiresAt);
    return { tokenId, token, name, expiresAt };
  }

  public async listTokens(userEmail: string): Promise<UserAccessTokenMetadata[]> {
    const dao: UserAccessTokenDAO = new UserAccessTokenDAO(this.env.AccessBridgeDB);
    return dao.getByUserEmail(userEmail);
  }

  public async deleteToken(tokenId: string, userEmail: string): Promise<void> {
    const dao: UserAccessTokenDAO = new UserAccessTokenDAO(this.env.AccessBridgeDB);
    await dao.delete(tokenId, userEmail);
  }
}export { TokenService };
export type { CreatedToken, TokenServiceEnv };
