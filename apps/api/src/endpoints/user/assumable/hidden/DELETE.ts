import { AssumableRolesDAO } from '@/dao';
import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';

class UnhideRoleRoute extends IActivityAPIRoute<UnhideRoleRequest, UnhideRoleResponse, UnhideRoleEnv> {
  schema = {
    tags: ['User'],
    summary: 'Unhide Role',
    description:
      "Unhide a previously hidden AWS IAM role, making it visible again in the user's assumable roles list. This restores the role's visibility in the UI without affecting the underlying permissions.",
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
                  description: 'AWS Account ID containing the role to unhide',
                  example: '123456789012',
                },
                roleName: {
                  type: 'string' as const,
                  minLength: 1,
                  maxLength: 64,
                  description: 'Name of the IAM role to unhide',
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
        description: 'Role unhidden successfully',
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
        description: 'Internal server error while unhiding role',
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

  protected async handleRequest(
    request: UnhideRoleRequest,
    env: UnhideRoleEnv,
    cxt: ActivityContext<UnhideRoleEnv>,
  ): Promise<UnhideRoleResponse> {
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const rolesDAO: AssumableRolesDAO = new AssumableRolesDAO(env.AccessBridgeDB);

    await rolesDAO.verifyUserHasAccessToRole(userEmail, request.awsAccountId, request.roleName);
    await rolesDAO.unhideRole(userEmail, request.awsAccountId, request.roleName);
    return { success: true };
  }
}

interface UnhideRoleRequest extends IRequest {
  awsAccountId: string;
  roleName: string;
}

interface UnhideRoleResponse extends IResponse {
  success: boolean;
}

type UnhideRoleEnv = IEnv;

export { UnhideRoleRoute };
export type { UnhideRoleRequest, UnhideRoleResponse };
