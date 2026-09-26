import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';

import { BadRequestError } from '@aws-access-bridge/backend-errors';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

class DeleteTokenRoute extends IActivityAPIRoute<DeleteTokenRequest, DeleteTokenResponse, DeleteTokenEnv> {
  schema = {
    tags: ['User'],
    summary: 'Delete Personal Access Token',
    description: 'Deletes a personal access token for the authenticated user',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['tokenId'],
            properties: {
              tokenId: {
                type: 'string' as const,
                description: 'ID of the token to delete',
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Token deleted successfully',
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
    security: [
      {
        CloudflareAccess: [],
      },
    ],
  };

  protected async handleRequest(
    request: DeleteTokenRequest,
    env: DeleteTokenEnv,
    cxt: ActivityContext<DeleteTokenEnv>,
  ): Promise<DeleteTokenResponse> {
    if (request.tokenId) {
      const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
      await getRequestScope(env).get(Tokens.TokenService).deleteToken(request.tokenId, userEmail);
      return { success: true };
    }
    throw new BadRequestError('Token ID is required');
  }
}

interface DeleteTokenRequest extends IRequest {
  tokenId: string;
}

interface DeleteTokenResponse extends IResponse {
  success: boolean;
}

type DeleteTokenEnv = IEnv;

export { DeleteTokenRoute };
export type { DeleteTokenRequest, DeleteTokenResponse };
