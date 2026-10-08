import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';

import type { UserAccessTokenMetadata } from '@aws-access-bridge/shared/model';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { internalServerErrorResponse, unauthorizedResponse } from '@aws-access-bridge/shared/schema/exceptionResponses';
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
                      createdAt: 1_704_067_200,
                      expiresAt: 1_711_929_600,
                      lastUsedAt: 1_704_153_600,
                    },
                    {
                      tokenId: 'tok_xyz789ghi012',
                      name: 'CLI Access',
                      createdAt: 1_704_153_600,
                      expiresAt: 1_735_689_600,
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
      '401': unauthorizedResponse('Unauthorized - Missing or invalid authentication'),
      '500': internalServerErrorResponse('Internal server error while listing tokens'),
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
    const tokens: UserAccessTokenMetadata[] = await getRequestScope(cxt).get(Tokens.TokenService).listTokens(userEmail);
    return { tokens };
  }
}

type ListTokensRequest = IRequest;

interface ListTokensResponse extends IResponse {
  tokens: UserAccessTokenMetadata[];
}

type ListTokensEnv = IEnv;

export { ListTokensRoute };
