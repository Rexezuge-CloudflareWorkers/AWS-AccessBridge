import { TeamsDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

class UpdateTeamNameRoute extends IAdminActivityAPIRoute<UpdateTeamNameRequest, UpdateTeamNameResponse, IAdminEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Update Team Name',
    description:
      'Updates the display name of an existing team. The team name is trimmed of leading/trailing whitespace and must not be empty.',
    requestBody: {
      description: 'New team name',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['teamId', 'teamName'],
            properties: {
              teamId: {
                type: 'string' as const,
                format: 'uuid',
                description: 'Unique identifier of the team to rename',
                example: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
              },
              teamName: {
                type: 'string' as const,
                minLength: 1,
                description: 'New display name for the team',
                example: 'Cloud Infrastructure',
              },
            },
          },
          examples: {
            'rename-team': {
              summary: 'Rename a team',
              value: { teamId: 'b2c3d4e5-f6a7-8901-bcde-f23456789012', teamName: 'Cloud Infrastructure' },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Team name updated successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: { type: 'boolean' as const, example: true },
                message: { type: 'string' as const, example: 'Team name updated.' },
              },
            },
            examples: {
              updated: {
                summary: 'Name updated',
                value: { success: true, message: 'Team name updated.' },
              },
            },
          },
        },
      },
      '400': {
        description: 'Bad request - Missing required fields or empty name',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'BadRequestError' },
                    Message: { type: 'string' as const, example: 'Missing required fields.' },
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
        description: 'Internal server error while updating team name',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to update team name.' },
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

  protected async handleAdminRequest(request: UpdateTeamNameRequest, env: IAdminEnv): Promise<UpdateTeamNameResponse> {
    if (!request.teamId || !request.teamName?.trim()) throw new BadRequestError('Missing required fields.');
    await new TeamsDAO(env.AccessBridgeDB).updateTeamName(request.teamId, request.teamName.trim());
    return { success: true, message: 'Team name updated.' };
  }
}

interface UpdateTeamNameRequest extends IRequest {
  teamId: string;
  teamName: string;
}
interface UpdateTeamNameResponse extends IResponse {
  success: boolean;
  message: string;
}
export { UpdateTeamNameRoute };
