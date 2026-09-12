import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import { TokenServiceFactory } from '@aws-access-bridge/backend-services/auth';

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
    return TokenServiceFactory.create(env).createToken(userEmail, request.name, request.expiresInDays);
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
  MAX_TOKENS_PER_USER?: string;
  MAX_TOKEN_EXPIRY_DAYS?: string;
}

export { CreateTokenRoute };
export type { CreateTokenRequest, CreateTokenResponse };
