import { TeamsDAO } from '@/dao';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import type { Team } from '@/model';

class ListTeamsRoute extends IAdminActivityAPIRoute<IRequest, ListTeamsResponse, IAdminEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'List Teams',
    description: 'Returns all teams in the system. Includes the default team and all user-created teams with their metadata.',
    responses: {
      '200': {
        description: 'List of all teams',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                teams: {
                  type: 'array' as const,
                  items: {
                    type: 'object' as const,
                    properties: {
                      id: { type: 'string' as const, format: 'uuid', description: 'Unique team identifier' },
                      name: { type: 'string' as const, description: 'Team display name' },
                      createdBy: { type: 'string' as const, description: 'Email of the admin who created the team' },
                      createdAt: { type: 'integer' as const, description: 'Unix timestamp of creation' },
                    },
                  },
                },
              },
            },
            examples: {
              'teams-list': {
                summary: 'List of teams',
                value: {
                  teams: [
                    {
                      id: '00000000-0000-0000-0000-000000000000',
                      name: 'Default',
                      createdBy: 'system',
                      createdAt: 1700000000,
                    },
                    {
                      id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
                      name: 'Platform Engineering',
                      createdBy: 'admin@example.com',
                      createdAt: 1704067200,
                    },
                  ],
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
        description: 'Internal server error while listing teams',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to list teams.' },
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

  protected async handleAdminRequest(_request: IRequest, env: IAdminEnv): Promise<ListTeamsResponse> {
    const teams: Team[] = await new TeamsDAO(env.AccessBridgeDB).listTeams();
    return { teams };
  }
}

interface ListTeamsResponse extends IResponse {
  teams: Team[];
}
export { ListTeamsRoute };
