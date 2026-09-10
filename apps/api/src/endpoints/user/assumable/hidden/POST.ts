import { AssumableRolesDAO } from '@/dao';
import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';

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
      '400': {
        description: 'Bad request - Invalid input parameters',
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
                      example: 'ValidationError',
                    },
                    Message: {
                      type: 'string' as const,
                      description: 'Validation error details',
                      example: 'Invalid AWS Account ID format',
                    },
                  },
                },
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
      '403': {
        description: 'Forbidden - User does not have access to this role',
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
                      description: 'Authorization error details',
                      example: "user@example.com is not authorized to assume role 'ReadOnlyRole' in AWS account 123456789012.",
                    },
                  },
                },
              },
            },
          },
        },
      },
      '500': {
        description: 'Internal server error while hiding role',
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
                      example: 'Database error while updating role visibility',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleRequest(request: HideRoleRequest, env: HideRoleEnv, cxt: ActivityContext<HideRoleEnv>): Promise<HideRoleResponse> {
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const rolesDAO: AssumableRolesDAO = new AssumableRolesDAO(env.AccessBridgeDB);

    await rolesDAO.verifyUserHasAccessToRole(userEmail, request.awsAccountId, request.roleName);
    await rolesDAO.hideRole(userEmail, request.awsAccountId, request.roleName);
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
