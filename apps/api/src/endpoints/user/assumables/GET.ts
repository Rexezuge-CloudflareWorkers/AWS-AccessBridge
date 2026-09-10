import { AssumableRolesDAO } from '@/dao';
import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import type { AssumableAccountsMap, AssumableAccountsResponse } from '@/model';

class ListAssumablesRoute extends IActivityAPIRoute<ListAssumablesRequest, ListAssumablesResponse, ListAssumablesEnv> {
  schema = {
    tags: ['User'],
    summary: 'List Assumable Roles',
    description:
      'Returns a list of AWS IAM roles that the authenticated user is authorized to assume, organized by AWS account ID. This endpoint helps users discover which roles they can access across different AWS accounts. By default, hidden roles are excluded from the results. Use the showHidden query parameter to include hidden roles.',
    parameters: [
      {
        name: 'showHidden',
        in: 'query' as const,
        description: 'Whether to include hidden roles in the results. Defaults to false.',
        required: false,
        schema: {
          type: 'boolean' as const,
          default: false,
        },
      },
      {
        name: 'limit',
        in: 'query' as const,
        description: 'Maximum number of roles to return. Defaults to 50, range 1-200.',
        required: false,
        schema: {
          type: 'integer' as const,
          minimum: 1,
          maximum: 200,
          default: 50,
        },
      },
      {
        name: 'offset',
        in: 'query' as const,
        description: 'Number of roles to skip for pagination. Defaults to 0.',
        required: false,
        schema: {
          type: 'integer' as const,
          minimum: 0,
          default: 0,
        },
      },
    ],
    responses: {
      '200': {
        description: 'Successfully retrieved list of assumable roles',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                totalAccounts: {
                  type: 'integer' as const,
                  description: 'Total number of AWS accounts the user has access to',
                  minimum: 0,
                },
              },
              additionalProperties: {
                type: 'object' as const,
                properties: {
                  roles: {
                    type: 'array' as const,
                    items: {
                      type: 'string' as const,
                      minLength: 1,
                      maxLength: 64,
                      description: 'IAM Role name',
                    },
                  },
                  hiddenRoles: {
                    type: 'array' as const,
                    description: 'Role names the user has hidden. Only populated when showHidden=true.',
                    items: {
                      type: 'string' as const,
                      minLength: 1,
                      maxLength: 64,
                      description: 'IAM Role name',
                    },
                  },
                  nickname: {
                    type: 'string' as const,
                    description: 'Optional AWS account nickname',
                  },
                  favorite: {
                    type: 'boolean' as const,
                    description: 'Whether this account is favorited by the user',
                  },
                },
                required: ['roles'],
              },
              required: ['totalAccounts'],
              description: 'Map of AWS Account IDs to objects containing role arrays and optional nicknames, plus total account count',
              example: {
                totalAccounts: 3,
                '123456789012': { roles: ['ReadOnlyRole', 'DeveloperRole', 'AdminRole'], nickname: 'Production', favorite: true },
                '987654321098': { roles: ['CrossAccountRole'], favorite: false },
                '555666777888': { roles: ['AuditorRole', 'ReadOnlyRole'], nickname: 'Development', favorite: true },
              },
            },
            examples: {
              'visible-roles-only': {
                summary: 'User with visible roles only (default behavior)',
                value: {
                  totalAccounts: 2,
                  '123456789012': { roles: ['ReadOnlyRole', 'DeveloperRole'], nickname: 'Production', favorite: true },
                  '987654321098': { roles: ['AdminRole'], favorite: false },
                },
              },
              'with-hidden-roles': {
                summary: 'User with hidden roles included (showHidden=true)',
                value: {
                  totalAccounts: 2,
                  '123456789012': {
                    roles: ['ReadOnlyRole', 'DeveloperRole'],
                    hiddenRoles: ['HiddenRole'],
                    nickname: 'Production',
                    favorite: true,
                  },
                  '987654321098': { roles: ['AdminRole'], hiddenRoles: ['AnotherHiddenRole'], favorite: false },
                },
              },
              'with-pagination': {
                summary: 'Paginated results (limit=2&offset=0)',
                value: {
                  totalAccounts: 3,
                  '123456789012': { roles: ['ReadOnlyRole', 'DeveloperRole'], nickname: 'Production', favorite: true },
                },
              },
              'single-account': {
                summary: 'User with roles in one account',
                value: {
                  totalAccounts: 1,
                  '123456789012': { roles: ['ReadOnlyRole', 'DeveloperRole', 'AdminRole'], nickname: 'Production', favorite: true },
                },
              },
              'no-roles': {
                summary: 'User with no assumable roles',
                value: {
                  totalAccounts: 0,
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
      '500': {
        description: 'Internal server error while retrieving roles',
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
                      example: 'Database error while retrieving assumable roles',
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

  protected async handleRequest(
    request: ListAssumablesRequest,
    env: ListAssumablesEnv,
    cxt: ActivityContext<ListAssumablesEnv>,
  ): Promise<ListAssumablesResponse> {
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(env.AccessBridgeDB);
    const url: URL = new URL(request.raw.url);
    const showHidden: boolean = url.searchParams.get('showHidden') === 'true';
    const limitParam: string | null = url.searchParams.get('limit');
    const offsetParam: string | null = url.searchParams.get('offset');
    const limit: number = limitParam ? Math.max(1, Math.min(200, parseInt(limitParam, 10))) : 50;
    const offset: number = offsetParam ? Math.max(0, parseInt(offsetParam, 10)) : 0;
    const totalAccounts: number = await assumableRolesDAO.getTotalAccountsCount(userEmail, showHidden);
    const assumableAccountsMap: AssumableAccountsMap = await assumableRolesDAO.getAllRolesByUserEmail(userEmail, showHidden, limit, offset);
    return {
      ...assumableAccountsMap,
      totalAccounts: totalAccounts,
    };
  }
}

type ListAssumablesRequest = IRequest;

type ListAssumablesResponse = IResponse & AssumableAccountsResponse;

type ListAssumablesEnv = IEnv;

export { ListAssumablesRoute };
export type { ListAssumablesRequest, ListAssumablesResponse };
