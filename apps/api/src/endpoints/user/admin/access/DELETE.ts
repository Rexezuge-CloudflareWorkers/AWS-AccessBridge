import { AssumableRolesDAO, AwsAccountsDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

class RevokeAccessRoute extends IAdminActivityAPIRoute<RevokeAccessRequest, RevokeAccessResponse, RevokeAccessEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Revoke User Access to Role',
    description:
      "Revokes a user's permission to assume a specific AWS role in an account. This removes the mapping from the assumable_roles table, preventing the user from assuming the role through the AWS Access Bridge. If the AWS account does not exist in the database, it will be created automatically (though this is primarily for consistency). If userEmail is not provided, access is revoked from the current admin user. This operation is idempotent - revoking access from a role that a user doesn't have access to will not cause an error.",
    requestBody: {
      description: 'User access details to revoke',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['awsAccountId', 'roleName'],
            properties: {
              userEmail: {
                type: 'string' as const,
                format: 'email',
                description: 'Email address of the user to revoke access from (optional - defaults to current admin user)',
                example: 'developer@example.com',
                maxLength: 120,
              },
              awsAccountId: {
                type: 'string' as const,
                pattern: '^[0-9]{12}$',
                description: 'AWS Account ID (exactly 12 digits)',
                example: '123456789012',
              },
              roleName: {
                type: 'string' as const,
                description: 'Name of the AWS IAM role to revoke access from (without ARN prefix)',
                example: 'DeveloperRole',
                maxLength: 128,
                minLength: 1,
              },
            },
          },
          examples: {
            'revoke-self-access': {
              summary: 'Revoke access from current admin user',
              description: 'Revokes access from the current admin user when no userEmail is specified',
              value: {
                awsAccountId: '123456789012',
                roleName: 'DeveloperRole',
              },
            },
            'revoke-developer-access': {
              summary: 'Revoke developer access from a role',
              description: "Removes a developer's ability to assume a development role in a specific AWS account",
              value: {
                userEmail: 'developer@example.com',
                awsAccountId: '123456789012',
                roleName: 'DeveloperRole',
              },
            },
            'revoke-contractor-access': {
              summary: 'Revoke contractor access from a role',
              description: "Removes a contractor's access when their engagement ends",
              value: {
                userEmail: 'contractor@external.com',
                awsAccountId: '987654321098',
                roleName: 'ContractorRole',
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Successfully revoked user access from the specified role',
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
                  example: 'Access revoked successfully',
                },
              },
            },
            examples: {
              'access-revoked': {
                summary: 'Successful access revocation',
                value: {
                  success: true,
                  message: 'Access revoked successfully',
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
              'invalid-email': {
                summary: 'Invalid email format',
                value: {
                  Exception: {
                    Type: 'BadRequestError',
                    Message: 'Invalid email format for userEmail.',
                  },
                },
              },
              'invalid-account-id': {
                summary: 'Invalid AWS Account ID',
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
        description: 'Internal server error during access revocation operation',
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
                      example: 'Failed to revoke user access from role in database',
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
    request: RevokeAccessRequest,
    env: RevokeAccessEnv,
    cxt: ActivityContext<RevokeAccessEnv>,
  ): Promise<RevokeAccessResponse> {
    if (request.awsAccountId && request.roleName) {
      if (/^[0-9]{12}$/.test(request.awsAccountId)) {
        const userEmail: string = request.userEmail || this.getAuthenticatedUserEmailAddress(cxt);
        const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(env.AccessBridgeDB);
        const accountsDAO: AwsAccountsDAO = new AwsAccountsDAO(env.AccessBridgeDB);
        await accountsDAO.ensureAccountExists(request.awsAccountId);
        await assumableRolesDAO.revokeUserAccessToRole(userEmail, request.awsAccountId, request.roleName);
        return {
          success: true,
          message: 'Access revoked successfully',
        };
      }
      throw new BadRequestError('AWS Account ID must be exactly 12 digits.');
    }
    throw new BadRequestError('Missing required fields.');
  }
}

interface RevokeAccessRequest extends IRequest {
  userEmail?: string | undefined;
  awsAccountId: string;
  roleName: string;
}

interface RevokeAccessResponse extends IResponse {
  success: boolean;
  message: string;
}

type RevokeAccessEnv = IAdminEnv;

export { RevokeAccessRoute };
export type { RevokeAccessRequest, RevokeAccessResponse };
