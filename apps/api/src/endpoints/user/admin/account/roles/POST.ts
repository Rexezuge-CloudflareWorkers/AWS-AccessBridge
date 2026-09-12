import { AccountServiceFactory } from '@aws-access-bridge/backend-services/account';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

class ListAccountRolesRoute extends IAdminActivityAPIRoute<ListAccountRolesRequest, ListAccountRolesResponse, ListAccountRolesEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'List IAM Roles in AWS Account',
    description:
      'Discovers available IAM roles in an AWS account by resolving the credential chain for the given principal ARN and calling IAM ListRoles. Requires the assumed role to have iam:ListRoles permission.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['principalArn'],
            properties: {
              principalArn: {
                type: 'string' as const,
                description: 'Principal ARN to use for discovering roles (must be a stored credential with a chain)',
                example: 'arn:aws:iam::123456789012:role/AdminRole',
              },
            },
          },
          examples: {
            'discover-roles': {
              summary: 'Discover IAM roles using a stored credential',
              value: { principalArn: 'arn:aws:iam::123456789012:role/AdminRole' },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'List of IAM roles in the account',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                roles: {
                  type: 'array' as const,
                  items: {
                    type: 'object' as const,
                    properties: {
                      roleName: { type: 'string' as const },
                      arn: { type: 'string' as const },
                      description: { type: 'string' as const },
                    },
                  },
                },
              },
            },
            examples: {
              'discovered-roles': {
                summary: 'Discovered IAM roles',
                value: {
                  roles: [
                    { roleName: 'AdminRole', arn: 'arn:aws:iam::123456789012:role/AdminRole', description: 'Full admin access' },
                    { roleName: 'DeveloperRole', arn: 'arn:aws:iam::123456789012:role/DeveloperRole', description: 'Developer access' },
                    { roleName: 'ReadOnlyRole', arn: 'arn:aws:iam::123456789012:role/ReadOnlyRole', description: '' },
                  ],
                },
              },
            },
          },
        },
      },
      '400': {
        description: 'Bad request - Missing field or insufficient IAM permissions',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'BadRequestError' },
                    Message: {
                      type: 'string' as const,
                      example: 'The assumed role does not have iam:ListRoles permission. You can still manually enter role names.',
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
                    Type: { type: 'string' as const, example: 'UnauthorizedError' },
                    Message: { type: 'string' as const, example: 'No Cloudflare Access JWT token provided in request headers.' },
                  },
                },
              },
            },
          },
        },
      },
      '403': {
        description: 'Forbidden - User is not a superadmin',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'UnauthorizedError' },
                    Message: { type: 'string' as const, example: 'User is not a super admin.' },
                  },
                },
              },
            },
          },
        },
      },
      '500': {
        description: 'Internal server error during IAM ListRoles call',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'IAM ListRoles failed: 500' },
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

  protected async handleAdminRequest(
    request: ListAccountRolesRequest,
    env: ListAccountRolesEnv,
    _cxt: ActivityContext<ListAccountRolesEnv>,
  ): Promise<ListAccountRolesResponse> {
    return AccountServiceFactory.create(env).listAccountRoles(request.principalArn);
  }
}

interface ListAccountRolesRequest extends IRequest {
  principalArn: string;
}

interface ListAccountRolesResponse extends IResponse {
  roles: Array<{ roleName: string; arn: string; description: string }>;
}

interface ListAccountRolesEnv extends IAdminEnv {
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  AccessBridgeDB: D1DatabaseSession;
  AES_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
}

export { ListAccountRolesRoute };
