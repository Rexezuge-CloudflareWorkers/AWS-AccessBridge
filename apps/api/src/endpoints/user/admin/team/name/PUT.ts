
import type { ActivityContext } from '@/endpoints/IAdminActivityAPIRoute';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { badRequestResponse, forbiddenResponse, internalServerErrorResponse, unauthorizedResponse } from '@aws-access-bridge/shared/schema/exceptionResponses';
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
      '400': badRequestResponse('Bad request - Missing required fields or empty name'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid authentication'),
      '403': forbiddenResponse('Forbidden - User is not a superadmin'),
      '500': internalServerErrorResponse('Internal server error while updating team name'),
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleAdminRequest(request: UpdateTeamNameRequest, env: IAdminEnv,
    cxt: ActivityContext<IAdminEnv>): Promise<UpdateTeamNameResponse> {
    await getRequestScope(cxt).get(Tokens.TeamService).updateTeamName(request.teamId, request.teamName);
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
