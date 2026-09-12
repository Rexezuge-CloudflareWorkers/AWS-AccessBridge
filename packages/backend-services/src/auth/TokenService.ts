import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { UserAccessTokenDAO } from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import { BadRequestError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
import type { UserAccessTokenMetadata } from '@aws-access-bridge/shared/model/UserAccessToken';
import { TimestampUtil, UUIDUtil } from '@aws-access-bridge/shared/utils';

interface TokenServiceEnv {
  AccessBridgeDB: D1Queryable;
  MAX_TOKENS_PER_USER?: string;
  MAX_TOKEN_EXPIRY_DAYS?: string;
}

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
    const existingTokens: UserAccessTokenMetadata[] = await dao.getByUserEmail(userEmail);
    if (existingTokens.length >= maxTokens) {
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
}

class TokenServiceFactory {
  public static create(env: TokenServiceEnv): TokenService {
    return new TokenService(env);
  }
}

export { TokenService, TokenServiceFactory };
export type { CreatedToken, TokenServiceEnv };
