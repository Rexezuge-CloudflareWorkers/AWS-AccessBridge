import { TeamsDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import type { Team } from '@/model';

class CreateTeamRoute extends IAdminActivityAPIRoute<CreateTeamRequest, CreateTeamResponse, IAdminEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Create Team',
    description:
      'Creates a new team workspace for organizing users and AWS accounts. The authenticated admin becomes the team creator. Teams provide multi-tenant boundaries that scope account access at the team level.',
    requestBody: {
      description: 'Team configuration',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['teamName'],
            properties: {
              teamName: {
                type: 'string' as const,
                minLength: 1,
                description: 'Display name for the new team',
                example: 'Platform Engineering',
              },
            },
          },
          examples: {
            'create-team': {
              summary: 'Create a new team',
              value: { teamName: 'Platform Engineering' },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Team created successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: { type: 'boolean' as const },
                team: {
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
            examples: {
              created: {
                summary: 'Team created',
                value: {
                  success: true,
                  team: {
                    id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
                    name: 'Platform Engineering',
                    createdBy: 'admin@example.com',
                    createdAt: 1704067200,
                  },
                },
              },
            },
          },
        },
      },
      '400': {
        description: 'Bad request - Missing or empty team name',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'BadRequestError' },
                    Message: { type: 'string' as const, example: 'Missing required field: teamName.' },
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
        description: 'Internal server error while creating team',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to create team.' },
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
    request: CreateTeamRequest,
    env: IAdminEnv,
    cxt: ActivityContext<IAdminEnv>,
  ): Promise<CreateTeamResponse> {
    if (!request.teamName?.trim()) throw new BadRequestError('Missing required field: teamName.');
    const teamsDAO: TeamsDAO = new TeamsDAO(env.AccessBridgeDB);
    const team: Team = await teamsDAO.createTeam(request.teamName.trim(), this.getAuthenticatedUserEmailAddress(cxt));
    return { success: true, team };
  }
}

interface CreateTeamRequest extends IRequest {
  teamName: string;
}
interface CreateTeamResponse extends IResponse {
  success: boolean;
  team: Team;
}
export { CreateTeamRoute };
