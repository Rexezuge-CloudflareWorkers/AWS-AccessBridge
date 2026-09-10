import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import { UserAccessTokenDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { UserAccessTokenMetadata } from '@/model';
import { DEFAULT_MAX_TOKEN_EXPIRY_DAYS, DEFAULT_MAX_TOKENS_PER_USER } from '@/constants';
import { TimestampUtil, UUIDUtil } from '@/utils';

class CreateTokenRoute extends IActivityAPIRoute<CreateTokenRequest, CreateTokenResponse, CreateTokenEnv> {
  schema = {
    tags: ['User'],
    summary: 'Create Personal Access Token',
    description: 'Creates a new personal access token for the authenticated user',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['name'],
            properties: {
              name: {
                type: 'string' as const,
                description: 'Name for the token',
                example: 'My API Token',
              },
              expiresInDays: {
                type: 'number' as const,
                description: 'Token expiry in days (max 90)',
                example: 30,
              },
            },
          },
        },
      },
    },
    responses: {
      '201': {
        description: 'Token created successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                tokenId: { type: 'string' as const },
                token: { type: 'string' as const },
                name: { type: 'string' as const },
                expiresAt: { type: 'number' as const },
              },
            },
          },
        },
      },
    },
    security: [
      {
        CloudflareAccess: [],
      },
    ],
  };

  protected async handleRequest(
    request: CreateTokenRequest,
    env: CreateTokenEnv,
    cxt: ActivityContext<CreateTokenEnv>,
  ): Promise<CreateTokenResponse> {
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const userAccessTokenDAO: UserAccessTokenDAO = new UserAccessTokenDAO(env.AccessBridgeDB);
    const maxTokens: number = parseInt(env.MAX_TOKENS_PER_USER || DEFAULT_MAX_TOKENS_PER_USER);
    const maxExpiryInDays: number = parseInt(env.MAX_TOKEN_EXPIRY_DAYS || DEFAULT_MAX_TOKEN_EXPIRY_DAYS);
    const existingTokens: UserAccessTokenMetadata[] = await userAccessTokenDAO.getByUserEmail(userEmail);
    if (existingTokens.length < maxTokens) {
      const expiresInDays: number = request.expiresInDays || maxExpiryInDays;
      if (expiresInDays <= maxExpiryInDays) {
        const tokenId: string = UUIDUtil.getRandomUUID();
        const token: string = UUIDUtil.getRandomUUIDNoDash() + UUIDUtil.getRandomUUIDNoDash();
        const expiresAt: number = TimestampUtil.addDays(TimestampUtil.getCurrentUnixTimestampInSeconds(), expiresInDays);
        await userAccessTokenDAO.create(tokenId, userEmail, token, request.name, expiresAt);
        return {
          tokenId,
          token,
          name: request.name,
          expiresAt,
        };
      }
      throw new BadRequestError(`Token expiry cannot exceed ${maxExpiryInDays} days`);
    }
    throw new BadRequestError(`Maximum ${maxTokens} tokens allowed per user`);
  }
}

interface CreateTokenRequest extends IRequest {
  name: string;
  expiresInDays?: number;
}

interface CreateTokenResponse extends IResponse {
  tokenId: string;
  token: string;
  name: string;
  expiresAt: number;
}

interface CreateTokenEnv extends IEnv {
  MAX_TOKENS_PER_USER?: string | undefined;
  MAX_TOKEN_EXPIRY_DAYS?: string | undefined;
}

export { CreateTokenRoute };
export type { CreateTokenRequest, CreateTokenResponse };
