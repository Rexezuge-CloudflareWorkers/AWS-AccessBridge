import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import { UserAccessTokenDAO } from '@/dao';
import type { UserAccessTokenMetadata } from '@/model';

class ListTokensRoute extends IActivityAPIRoute<ListTokensRequest, ListTokensResponse, ListTokensEnv> {
  schema = {
    tags: ['User'],
    summary: 'List Personal Access Tokens',
    description: 'Lists all personal access tokens for the authenticated user',
    responses: {
      '200': {
        description: 'Tokens retrieved successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                tokens: {
                  type: 'array' as const,
                  items: {
                    type: 'object' as const,
                    properties: {
                      tokenId: { type: 'string' as const, description: 'Unique token identifier' },
                      name: { type: 'string' as const, description: 'User-assigned token name' },
                      createdAt: { type: 'number' as const, description: 'Unix timestamp when the token was created' },
                      expiresAt: { type: 'number' as const, description: 'Unix timestamp when the token expires' },
                      lastUsedAt: { type: 'number' as const, description: 'Unix timestamp of last usage (0 if never used)' },
                    },
                  },
                },
              },
            },
            examples: {
              'with-tokens': {
                summary: 'User has active tokens',
                value: {
                  tokens: [
                    {
                      tokenId: 'tok_abc123def456',
                      name: 'CI/CD Pipeline',
                      createdAt: 1704067200,
                      expiresAt: 1711929600,
                      lastUsedAt: 1704153600,
                    },
                    {
                      tokenId: 'tok_xyz789ghi012',
                      name: 'CLI Access',
                      createdAt: 1704153600,
                      expiresAt: 1735689600,
                      lastUsedAt: 0,
                    },
                  ],
                },
              },
              'no-tokens': {
                summary: 'User has no tokens',
                value: { tokens: [] },
              },
            },
          },
        },
      },
      '401': {
        description: 'Unauthorized - Missing or invalid authentication',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'UnauthorizedError' },
                    Message: { type: 'string' as const, example: 'No Cloudflare Access JWT token provided in request headers.' },
                  },
                },
              },
            },
          },
        },
      },
      '500': {
        description: 'Internal server error while listing tokens',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to list access tokens.' },
                  },
                },
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
    _request: ListTokensRequest,
    env: ListTokensEnv,
    cxt: ActivityContext<ListTokensEnv>,
  ): Promise<ListTokensResponse> {
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const userAccessTokenDAO: UserAccessTokenDAO = new UserAccessTokenDAO(env.AccessBridgeDB);
    const tokens: UserAccessTokenMetadata[] = await userAccessTokenDAO.getByUserEmail(userEmail);
    return { tokens };
  }
}

type ListTokensRequest = IRequest;

interface ListTokensResponse extends IResponse {
  tokens: UserAccessTokenMetadata[];
}

type ListTokensEnv = IEnv;

export { ListTokensRoute };
export type { ListTokensRequest, ListTokensResponse };
