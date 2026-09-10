import { TeamsDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

class DeleteTeamRoute extends IAdminActivityAPIRoute<DeleteTeamRequest, DeleteTeamResponse, IAdminEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Delete Team',
    description:
      'Permanently deletes a team and all its associations (members, account mappings). The default team (UUID 00000000-0000-0000-0000-000000000000) cannot be deleted. This action is irreversible.',
    requestBody: {
      description: 'Team to delete',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['teamId'],
            properties: {
              teamId: {
                type: 'string' as const,
                format: 'uuid',
                description: 'Unique identifier of the team to delete',
                example: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
              },
            },
          },
          examples: {
            'delete-team': {
              summary: 'Delete a team',
              value: { teamId: 'b2c3d4e5-f6a7-8901-bcde-f23456789012' },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Team deleted successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: { type: 'boolean' as const, example: true },
                message: { type: 'string' as const, example: 'Team deleted.' },
              },
            },
            examples: {
              deleted: {
                summary: 'Team deleted',
                value: { success: true, message: 'Team deleted.' },
              },
            },
          },
        },
      },
      '400': {
        description: 'Bad request - Missing team ID or attempted to delete the default team',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'BadRequestError' },
                    Message: { type: 'string' as const, example: 'Cannot delete the default team.' },
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
        description: 'Internal server error while deleting team',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to delete team.' },
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

  protected async handleAdminRequest(request: DeleteTeamRequest, env: IAdminEnv): Promise<DeleteTeamResponse> {
    if (!request.teamId) throw new BadRequestError('Missing required field: teamId.');
    if (request.teamId === '00000000-0000-0000-0000-000000000000') throw new BadRequestError('Cannot delete the default team.');
    await new TeamsDAO(env.AccessBridgeDB).deleteTeam(request.teamId);
    return { success: true, message: 'Team deleted.' };
  }
}

interface DeleteTeamRequest extends IRequest {
  teamId: string;
}
interface DeleteTeamResponse extends IResponse {
  success: boolean;
  message: string;
}
export { DeleteTeamRoute };
