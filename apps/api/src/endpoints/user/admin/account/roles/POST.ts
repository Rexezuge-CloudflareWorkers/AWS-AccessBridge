
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { badRequestResponse, forbiddenResponse, internalServerErrorResponse, unauthorizedResponse } from '@aws-access-bridge/shared/schema/exceptionResponses';
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
      '400': badRequestResponse('Bad request - Missing field or insufficient IAM permissions'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid authentication'),
      '403': forbiddenResponse('Forbidden - User is not a superadmin'),
      '500': internalServerErrorResponse('Internal server error during IAM ListRoles call'),
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleAdminRequest(
    request: ListAccountRolesRequest,
    env: ListAccountRolesEnv,
    _cxt: ActivityContext<ListAccountRolesEnv>,
  ): Promise<ListAccountRolesResponse> {
    return getRequestScope(_cxt).get(Tokens.AccountService).listAccountRoles(request.principalArn);
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
  CREDENTIAL_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
  CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
}

export { ListAccountRolesRoute };
