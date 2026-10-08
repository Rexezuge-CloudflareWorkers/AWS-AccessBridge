import type { ActivityContext } from '@/endpoints/IAdminActivityAPIRoute';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import {
  badRequestResponse,
  conflictResponse,
  forbiddenResponse,
  internalServerErrorResponse,
  unauthorizedResponse,
} from '@aws-access-bridge/shared/schema/exceptionResponses';
class AddTeamMemberRoute extends IAdminActivityAPIRoute<AddTeamMemberRequest, AddTeamMemberResponse, IAdminEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Add Team Member',
    description:
      'Adds a user to a team with a specified role. Team members can be assigned as either "admin" (can manage the team) or "member" (basic access). Defaults to "member" if no role is specified.',
    requestBody: {
      description: 'Member to add',
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
                description: 'Team to add the member to',
                example: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
              },
              userEmail: {
                type: 'string' as const,
                format: 'email',
                description: 'Email address of the user to add',
                example: 'developer@example.com',
              },
              role: {
                type: 'string' as const,
                enum: ['admin', 'member'],
                default: 'member',
                description: 'Role to assign to the member within this team',
              },
            },
          },
          examples: {
            'add-member': {
              summary: 'Add a regular team member',
              value: { teamId: 'b2c3d4e5-f6a7-8901-bcde-f23456789012', userEmail: 'developer@example.com', role: 'member' },
            },
            'add-admin': {
              summary: 'Add a team admin',
              value: { teamId: 'b2c3d4e5-f6a7-8901-bcde-f23456789012', userEmail: 'lead@example.com', role: 'admin' },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Member added to team successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: { type: 'boolean' as const, example: true },
                message: { type: 'string' as const, example: 'Member added.' },
              },
            },
            examples: {
              added: {
                summary: 'Member added',
                value: { success: true, message: 'Member added.' },
              },
            },
          },
        },
      },
      '400': badRequestResponse('Bad request - Missing required fields'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid authentication'),
      '403': forbiddenResponse('Forbidden - User is not a superadmin'),
      '409': conflictResponse('Conflict - That user is already a member of this team'),
      '500': internalServerErrorResponse('Internal server error while adding team member'),
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleAdminRequest(
    request: AddTeamMemberRequest,
    env: IAdminEnv,
    cxt: ActivityContext<IAdminEnv>,
  ): Promise<AddTeamMemberResponse> {
    await getRequestScope(cxt)
      .get(Tokens.TeamService)
      .addMember(request.teamId, request.userEmail, request.role || 'member');
    return { success: true, message: 'Member added.' };
  }
}

interface AddTeamMemberRequest extends IRequest {
  teamId: string;
  userEmail: string;
  role?: string;
}
interface AddTeamMemberResponse extends IResponse {
  success: boolean;
  message: string;
}
export { AddTeamMemberRoute };
