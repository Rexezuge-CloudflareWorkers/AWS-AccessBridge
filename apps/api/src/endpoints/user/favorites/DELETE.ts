import { UserFavoriteAccountsDAO } from '@/dao';
import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';

class UnfavoriteAccountRoute extends IActivityAPIRoute<UnfavoriteAccountRequest, UnfavoriteAccountResponse, UnfavoriteAccountEnv> {
  schema = {
    tags: ['User'],
    summary: 'Unfavorite AWS Account',
    description: "Remove an AWS account from the user's favorites list",
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
                  description: 'AWS Account ID to unfavorite',
                },
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Account unfavorited successfully',
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
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleRequest(
    request: UnfavoriteAccountRequest,
    env: UnfavoriteAccountEnv,
    cxt: ActivityContext<UnfavoriteAccountEnv>,
  ): Promise<UnfavoriteAccountResponse> {
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const favoritesDAO: UserFavoriteAccountsDAO = new UserFavoriteAccountsDAO(env.AccessBridgeDB);

    await favoritesDAO.unfavoriteAccount(userEmail, request.awsAccountId);
    return { success: true };
  }
}

interface UnfavoriteAccountRequest extends IRequest {
  awsAccountId: string;
}

interface UnfavoriteAccountResponse extends IResponse {
  success: boolean;
}

type UnfavoriteAccountEnv = IEnv;

export { UnfavoriteAccountRoute };
export type { UnfavoriteAccountRequest, UnfavoriteAccountResponse };
