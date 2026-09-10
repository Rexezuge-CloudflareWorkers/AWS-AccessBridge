import { TeamAccountsDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

class ListTeamAccountsRoute extends IAdminActivityAPIRoute<IRequest, ListTeamAccountsResponse, IAdminEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'List Team Accounts',
    description:
      'Returns all AWS Account IDs associated with a specific team. These are the accounts that team members can potentially access based on their individual role grants.',
    parameters: [
      {
        name: 'teamId',
        in: 'query' as const,
        required: true,
        description: 'Unique identifier of the team to list accounts for',
        schema: { type: 'string' as const, format: 'uuid', example: 'b2c3d4e5-f6a7-8901-bcde-f23456789012' },
      },
    ],
    responses: {
      '200': {
        description: 'List of AWS Account IDs associated with the team',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                accountIds: {
                  type: 'array' as const,
                  items: { type: 'string' as const, description: 'AWS Account ID (12 digits)' },
                  description: 'AWS Account IDs associated with the team',
                },
              },
            },
            examples: {
              'team-accounts': {
                summary: 'Team with multiple accounts',
                value: { accountIds: ['123456789012', '987654321098', '111222333444'] },
              },
              empty: {
                summary: 'Team with no accounts',
                value: { accountIds: [] },
              },
            },
          },
        },
      },
      '400': {
        description: 'Bad request - Missing required parameter',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'BadRequestError' },
                    Message: { type: 'string' as const, example: 'Missing required parameter: teamId.' },
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
        description: 'Internal server error while listing team accounts',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to list team accounts.' },
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
    _request: IRequest,
    env: IAdminEnv,
    cxt: ActivityContext<IAdminEnv>,
  ): Promise<ListTeamAccountsResponse> {
    const teamId: string | null = new URL(cxt.req.url).searchParams.get('teamId');
    if (!teamId) throw new BadRequestError('Missing required parameter: teamId.');
    const accountIds: string[] = await new TeamAccountsDAO(env.AccessBridgeDB).getAccountsByTeam(teamId);
    return { accountIds };
  }
}

interface ListTeamAccountsResponse extends IResponse {
  accountIds: string[];
}
export { ListTeamAccountsRoute };
