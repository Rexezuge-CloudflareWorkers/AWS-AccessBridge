import { AssumableRolesDAO } from '@/dao';
import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import type { AssumableAccountsMap } from '@/model';

class SearchAccountsRoute extends IActivityAPIRoute<SearchAccountsRequest, SearchAccountsResponse, SearchAccountsEnv> {
  schema = {
    tags: ['User'],
    summary: 'Search Assumable Accounts',
    description:
      'Searches AWS accounts that the authenticated user has access to by AWS account ID or nickname. Returns accounts where the query matches either the account ID or nickname.',
    parameters: [
      {
        name: 'q',
        in: 'query' as const,
        description: 'Search query to match against AWS account ID or nickname',
        required: true,
        schema: {
          type: 'string' as const,
          minLength: 1,
          maxLength: 100,
        },
      },
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
    ],
    responses: {
      '200': {
        description: 'Successfully retrieved matching accounts',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              additionalProperties: {
                type: 'object' as const,
                properties: {
                  roles: {
                    type: 'array' as const,
                    items: {
                      type: 'string' as const,
                      description: 'IAM Role name',
                    },
                  },
                  hiddenRoles: {
                    type: 'array' as const,
                    description: 'Role names the user has hidden. Only populated when showHidden=true.',
                    items: {
                      type: 'string' as const,
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
            },
            examples: {
              'search-by-nickname': {
                summary: 'Search by account nickname "prod"',
                value: {
                  '123456789012': {
                    roles: ['ReadOnlyRole', 'DeveloperRole'],
                    nickname: 'Production',
                    favorite: true,
                  },
                },
              },
              'search-by-account-id': {
                summary: 'Search by account ID "555666"',
                value: {
                  '555666777888': {
                    roles: ['AuditorRole', 'ReadOnlyRole'],
                    nickname: 'Development',
                    favorite: false,
                  },
                },
              },
              'multiple-matches': {
                summary: 'Multiple accounts matching "dev"',
                value: {
                  '555666777888': {
                    roles: ['DeveloperRole'],
                    nickname: 'Development',
                    favorite: true,
                  },
                  '999888777666': {
                    roles: ['DevOpsRole'],
                    nickname: 'DevOps',
                    favorite: false,
                  },
                },
              },
              'no-matches': {
                summary: 'No accounts found',
                value: {},
              },
            },
          },
        },
      },
      '400': {
        description: 'Bad request - Missing or invalid query parameter',
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
                      example: 'Query parameter "q" is required',
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
                      example: 'No Cloudflare Access JWT token provided in request headers.',
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
    request: SearchAccountsRequest,
    env: SearchAccountsEnv,
    cxt: ActivityContext<SearchAccountsEnv>,
  ): Promise<SearchAccountsResponse> {
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const url: URL = new URL(request.raw.url);
    const query: string | null = url.searchParams.get('q');

    if (!query || query.trim().length === 0) {
      throw new Error('Query parameter "q" is required');
    }

    const showHidden: boolean = url.searchParams.get('showHidden') === 'true';
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(env.AccessBridgeDB);
    const matchingAccounts: AssumableAccountsMap = await assumableRolesDAO.searchAccountsByQuery(userEmail, query.trim(), showHidden);

    return matchingAccounts;
  }
}

type SearchAccountsRequest = IRequest;

type SearchAccountsResponse = IResponse & AssumableAccountsMap;

type SearchAccountsEnv = IEnv;

export { SearchAccountsRoute };
export type { SearchAccountsRequest, SearchAccountsResponse };
