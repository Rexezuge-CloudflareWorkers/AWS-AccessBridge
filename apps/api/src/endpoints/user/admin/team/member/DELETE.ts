
import type { ActivityContext } from '@/endpoints/IAdminActivityAPIRoute';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { badRequestResponse, forbiddenResponse, internalServerErrorResponse, unauthorizedResponse } from '@aws-access-bridge/shared/schema/exceptionResponses';
class RemoveTeamMemberRoute extends IAdminActivityAPIRoute<RemoveTeamMemberRequest, RemoveTeamMemberResponse, IAdminEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Remove Team Member',
    description:
      'Removes a user from a team. The user will lose access to any AWS accounts scoped to this team. This does not delete the user account itself.',
    requestBody: {
      description: 'Member to remove',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['teamId', 'userEmail'],
            properties: {
              teamId: {
                type: 'string' as const,
                format: 'uuid',
                description: 'Team to remove the member from',
                example: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
              },
              userEmail: {
                type: 'string' as const,
                format: 'email',
                description: 'Email address of the user to remove',
                example: 'developer@example.com',
              },
            },
          },
          examples: {
            'remove-member': {
              summary: 'Remove a team member',
              value: { teamId: 'b2c3d4e5-f6a7-8901-bcde-f23456789012', userEmail: 'developer@example.com' },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Member removed from team successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: { type: 'boolean' as const, example: true },
                message: { type: 'string' as const, example: 'Member removed.' },
              },
            },
            examples: {
              removed: {
                summary: 'Member removed',
                value: { success: true, message: 'Member removed.' },
              },
            },
          },
        },
      },
      '400': badRequestResponse('Bad request - Missing required fields'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid authentication'),
      '403': forbiddenResponse('Forbidden - User is not a superadmin'),
      '500': internalServerErrorResponse('Internal server error while removing team member'),
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleAdminRequest(request: RemoveTeamMemberRequest, env: IAdminEnv,
    cxt: ActivityContext<IAdminEnv>): Promise<RemoveTeamMemberResponse> {
    await getRequestScope(cxt).get(Tokens.TeamService).removeMember(request.teamId, request.userEmail);
    return { success: true, message: 'Member removed.' };
  }
}

interface RemoveTeamMemberRequest extends IRequest {
  teamId: string;
  userEmail: string;
}
interface RemoveTeamMemberResponse extends IResponse {
  success: boolean;
  message: string;
}
export { RemoveTeamMemberRoute };
