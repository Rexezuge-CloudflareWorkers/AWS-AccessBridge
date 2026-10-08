import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';
import {
  badRequestResponse,
  forbiddenResponse,
  internalServerErrorResponse,
  unauthorizedResponse,
} from '@aws-access-bridge/shared/schema/exceptionResponses';

class FavoriteAccountRoute extends IActivityAPIRoute<FavoriteAccountRequest, FavoriteAccountResponse, FavoriteAccountEnv> {
  schema = {
    tags: ['User'],
    summary: 'Favorite AWS Account',
    description: "Add an AWS account to the user's favorites list",
    request: {
      body: {
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              required: ['awsAccountId'],
              properties: {
                awsAccountId: {
                  type: 'string' as const,
                  pattern: '^[0-9]{12}$',
                  description: 'AWS Account ID to favorite',
                },
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Account favorited successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: { type: 'boolean' as const },
              },
            },
          },
        },
      },
      '400': badRequestResponse('Bad request - Missing required fields'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid authentication'),
      // Favouriting an account the caller has no grant for is refused rather
      // than stored: the row would show in the list and never be usable.
      '403': forbiddenResponse('Forbidden - You do not have access to that account'),
      '500': internalServerErrorResponse('Internal server error while favoriting account'),
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleRequest(
    request: FavoriteAccountRequest,
    env: FavoriteAccountEnv,
    cxt: ActivityContext<FavoriteAccountEnv>,
  ): Promise<FavoriteAccountResponse> {
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    await getRequestScope(cxt).get(Tokens.UserService).favoriteAccount(userEmail, request.awsAccountId);
    return { success: true };
  }
}

interface FavoriteAccountRequest extends IRequest {
  awsAccountId: string;
}

interface FavoriteAccountResponse extends IResponse {
  success: boolean;
}

type FavoriteAccountEnv = IEnv;

export { FavoriteAccountRoute };
