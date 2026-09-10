import { RoleConfigsDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

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
      '400': {
        description: 'Invalid request parameters - missing required fields or malformed data',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: {
                      type: 'string' as const,
                      example: 'BadRequestError',
                    },
                    Message: {
                      type: 'string' as const,
                      description: 'Details about the invalid request parameters',
                      example: 'Missing required fields.',
                    },
                  },
                },
              },
            },
            examples: {
              'missing-fields': {
                summary: 'Missing required fields',
                value: {
                  Exception: {
                    Type: 'BadRequestError',
                    Message: 'Missing required fields.',
                  },
                },
              },
              'invalid-account-id': {
                summary: 'Invalid AWS Account ID format',
                value: {
                  Exception: {
                    Type: 'BadRequestError',
                    Message: 'AWS Account ID must be exactly 12 digits.',
                  },
                },
              },
              'empty-role-name': {
                summary: 'Empty role name',
                value: {
                  Exception: {
                    Type: 'BadRequestError',
                    Message: 'Role name cannot be empty.',
                  },
                },
              },
              'role-name-too-long': {
                summary: 'Role name exceeds maximum length',
                value: {
                  Exception: {
                    Type: 'BadRequestError',
                    Message: 'Role name cannot exceed 128 characters.',
                  },
                },
              },
            },
          },
        },
      },
      '401': {
        description: 'Unauthorized - Missing or invalid Cloudflare Access authentication',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: {
                      type: 'string' as const,
                      example: 'UnauthorizedError',
                    },
                    Message: {
                      type: 'string' as const,
                      description: 'Authentication error details',
                      example: 'No Cloudflare Access JWT token provided in request headers.',
                    },
                  },
                },
              },
            },
          },
        },
      },
      '500': {
        description: 'Internal server error during role configuration deletion',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: {
                      type: 'string' as const,
                      example: 'InternalServerError',
                    },
                    Message: {
                      type: 'string' as const,
                      description: 'Error description',
                      example: 'Failed to delete role configuration from database',
                    },
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

  protected async handleAdminRequest(
    request: DeleteRoleConfigRequest,
    env: DeleteRoleConfigEnv,
    _cxt: ActivityContext<DeleteRoleConfigEnv>,
  ): Promise<DeleteRoleConfigResponse> {
    if (!request.awsAccountId || !request.roleName) {
      throw new BadRequestError('Missing required fields.');
    }

    const roleConfigsDAO: RoleConfigsDAO = new RoleConfigsDAO(env.AccessBridgeDB);
    await roleConfigsDAO.deleteRoleConfig(request.awsAccountId, request.roleName);

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
export type { DeleteRoleConfigRequest, DeleteRoleConfigResponse };
