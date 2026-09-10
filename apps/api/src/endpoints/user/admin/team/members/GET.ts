import { TeamMembersDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import type { TeamMember } from '@/model';

class ListTeamMembersRoute extends IAdminActivityAPIRoute<IRequest, ListTeamMembersResponse, IAdminEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'List Team Members',
    description: 'Returns all members of a specific team, including their email addresses and roles (admin or member).',
    parameters: [
      {
        name: 'teamId',
        in: 'query' as const,
        required: true,
        description: 'Unique identifier of the team to list members for',
        schema: { type: 'string' as const, format: 'uuid', example: 'b2c3d4e5-f6a7-8901-bcde-f23456789012' },
      },
    ],
    responses: {
      '200': {
        description: 'List of team members',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                members: {
                  type: 'array' as const,
                  items: {
                    type: 'object' as const,
                    properties: {
                      teamId: { type: 'string' as const, description: 'Team ID' },
                      userEmail: { type: 'string' as const, description: 'Member email address' },
                      role: { type: 'string' as const, enum: ['admin', 'member'], description: 'Member role within the team' },
                      addedAt: { type: 'integer' as const, description: 'Unix timestamp when the member was added' },
                    },
                  },
                },
              },
            },
            examples: {
              'team-members': {
                summary: 'Team with multiple members',
                value: {
                  members: [
                    {
                      teamId: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
                      userEmail: 'admin@example.com',
                      role: 'admin',
                      addedAt: 1704067200,
                    },
                    {
                      teamId: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
                      userEmail: 'developer@example.com',
                      role: 'member',
                      addedAt: 1704153600,
                    },
                  ],
                },
              },
              'empty-team': {
                summary: 'Team with no members',
                value: { members: [] },
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
        description: 'Internal server error while listing team members',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to list team members.' },
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
  ): Promise<ListTeamMembersResponse> {
    const teamId: string | null = new URL(cxt.req.url).searchParams.get('teamId');
    if (!teamId) throw new BadRequestError('Missing required parameter: teamId.');
    const members: TeamMember[] = await new TeamMembersDAO(env.AccessBridgeDB).getMembersByTeam(teamId);
    return { members };
  }
}

interface ListTeamMembersResponse extends IResponse {
  members: TeamMember[];
}
export { ListTeamMembersRoute };
