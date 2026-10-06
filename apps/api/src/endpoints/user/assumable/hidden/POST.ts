
import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { badRequestResponse, forbiddenResponse, internalServerErrorResponse, unauthorizedResponse } from '@aws-access-bridge/shared/schema/exceptionResponses';
class HideRoleRoute extends IActivityAPIRoute<HideRoleRequest, HideRoleResponse, HideRoleEnv> {
  schema = {
    tags: ['User'],
    summary: 'Hide Role',
    description:
      "Hide a specific AWS IAM role from the user's assumable roles list. The role remains accessible but will be hidden from the UI. This is useful for decluttering the interface when users have access to many roles.",
    request: {
      body: {
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              required: ['awsAccountId', 'roleName'],
              properties: {
                awsAccountId: {
                  type: 'string' as const,
                  pattern: '^[0-9]{12}$',
                  description: 'AWS Account ID containing the role to hide',
                  example: '123456789012',
                },
                roleName: {
                  type: 'string' as const,
                  minLength: 1,
                  maxLength: 64,
                  description: 'Name of the IAM role to hide',
                  example: 'ReadOnlyRole',
                },
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Role hidden successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: {
                  type: 'boolean' as const,
                  description: 'Indicates the operation completed successfully',
                  example: true,
                },
              },
            },
          },
        },
      },
      '400': badRequestResponse('Bad request - Invalid input parameters'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid authentication'),
      '403': forbiddenResponse('Forbidden - User does not have access to this role'),
      '500': internalServerErrorResponse('Internal server error while hiding role'),
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleRequest(request: HideRoleRequest, env: HideRoleEnv, cxt: ActivityContext<HideRoleEnv>): Promise<HideRoleResponse> {
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    await getRequestScope(cxt).get(Tokens.UserService).hideRole(userEmail, request.awsAccountId, request.roleName);
    return { success: true };
  }
}

interface HideRoleRequest extends IRequest {
  awsAccountId: string;
  roleName: string;
}

interface HideRoleResponse extends IResponse {
  success: boolean;
}

type HideRoleEnv = IEnv;

export { HideRoleRoute };
export type { HideRoleRequest, HideRoleResponse };
