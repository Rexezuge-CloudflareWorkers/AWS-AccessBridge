import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { badRequestResponse, internalServerErrorResponse, unauthorizedResponse } from '@aws-access-bridge/shared/schema/exceptionResponses';
class DeleteRoleConfigRoute extends IAdminActivityAPIRoute<DeleteRoleConfigRequest, DeleteRoleConfigResponse, DeleteRoleConfigEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Delete Role Configuration',
    description:
      'Removes configuration for a specific AWS role, clearing any custom destination path and region settings. After deletion, the role will use default AWS Console behavior when assumed. This operation is idempotent - attempting to delete a configuration that does not exist will not cause an error.',
    requestBody: {
      description: 'Role configuration to delete',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['awsAccountId', 'roleName'],
            properties: {
              awsAccountId: {
                type: 'string' as const,
                pattern: '^[0-9]{12}$',
                description: 'AWS Account ID (exactly 12 digits)',
                example: '123456789012',
              },
              roleName: {
                type: 'string' as const,
                description: 'Name of the AWS IAM role to remove configuration from (without ARN prefix)',
                example: 'DeveloperRole',
                maxLength: 128,
                minLength: 1,
              },
            },
          },
          examples: {
            'delete-developer-config': {
              summary: 'Delete developer role configuration',
              description: 'Removes custom console redirection settings for a developer role',
              value: {
                awsAccountId: '123456789012',
                roleName: 'DeveloperRole',
              },
            },
            'delete-admin-config': {
              summary: 'Delete admin role configuration',
              description: 'Removes custom console redirection settings for an admin role',
              value: {
                awsAccountId: '987654321098',
                roleName: 'AdminRole',
              },
            },
            'delete-readonly-config': {
              summary: 'Delete read-only role configuration',
              description: 'Removes configuration for a read-only access role',
              value: {
                awsAccountId: '555666777888',
                roleName: 'ReadOnlyRole',
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Successfully deleted the role configuration',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              required: ['success', 'message'],
              properties: {
                success: {
                  type: 'boolean' as const,
                  description: 'Indicates if the operation was successful',
                  example: true,
                },
                message: {
                  type: 'string' as const,
                  description: 'Human-readable success message',
                  example: 'Role configuration deleted successfully',
                },
              },
            },
            examples: {
              'config-deleted': {
                summary: 'Successful role configuration deletion',
                value: {
                  success: true,
                  message: 'Role configuration deleted successfully',
                },
              },
            },
          },
        },
      },
      '400': badRequestResponse('Invalid request parameters - missing required fields or malformed data'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid Cloudflare Access authentication'),
      '500': internalServerErrorResponse('Internal server error during role configuration deletion'),
    },
    security: [
      {
        CloudflareAccess: [],
      },
    ],
  };

  protected async handleAdminRequest(
    request: DeleteRoleConfigRequest,
    env: DeleteRoleConfigEnv,
    _cxt: ActivityContext<DeleteRoleConfigEnv>,
  ): Promise<DeleteRoleConfigResponse> {
    await getRequestScope(_cxt).get(Tokens.AccountService).deleteRoleConfig(request.awsAccountId, request.roleName);

    return {
      success: true,
      message: 'Role configuration deleted successfully',
    };
  }
}

interface DeleteRoleConfigRequest extends IRequest {
  awsAccountId: string;
  roleName: string;
}

interface DeleteRoleConfigResponse extends IResponse {
  success: boolean;
  message: string;
}

type DeleteRoleConfigEnv = IAdminEnv;

export { DeleteRoleConfigRoute };
