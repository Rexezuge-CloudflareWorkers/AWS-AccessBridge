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
  notFoundResponse,
  unauthorizedResponse,
} from '@aws-access-bridge/shared/schema/exceptionResponses';
class UpdateTeamMemberRoleRoute extends IAdminActivityAPIRoute<UpdateRoleRequest, UpdateRoleResponse, IAdminEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Update Team Member Role',
    description:
      'Changes the role of an existing team member between "admin" and "member". Team admins can manage team settings and members, while regular members have basic access to team resources.',
    requestBody: {
      description: 'Updated role assignment',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['teamId', 'userEmail', 'role'],
            properties: {
              teamId: {
                type: 'string' as const,
                format: 'uuid',
                description: 'Team the member belongs to',
                example: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
              },
              userEmail: {
                type: 'string' as const,
                format: 'email',
                description: 'Email of the member to update',
                example: 'developer@example.com',
              },
              role: {
                type: 'string' as const,
                enum: ['admin', 'member'],
                description: 'New role to assign',
              },
            },
          },
          examples: {
            'promote-to-admin': {
              summary: 'Promote member to admin',
              value: { teamId: 'b2c3d4e5-f6a7-8901-bcde-f23456789012', userEmail: 'developer@example.com', role: 'admin' },
            },
            'demote-to-member': {
              summary: 'Demote admin to member',
              value: { teamId: 'b2c3d4e5-f6a7-8901-bcde-f23456789012', userEmail: 'former-lead@example.com', role: 'member' },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Team member role updated successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: { type: 'boolean' as const, example: true },
                message: { type: 'string' as const, example: 'Role updated.' },
              },
            },
            examples: {
              updated: {
                summary: 'Role updated',
                value: { success: true, message: 'Role updated.' },
              },
            },
          },
        },
      },
      '400': badRequestResponse('Bad request - Missing required fields'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid authentication'),
      '403': forbiddenResponse('Forbidden - User is not a superadmin'),
      '404': notFoundResponse('Not Found - That user is not a member of this team'),
      '409': conflictResponse('Conflict - The team must keep at least one admin'),
      '500': internalServerErrorResponse('Internal server error while updating role'),
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleAdminRequest(
    request: UpdateRoleRequest,
    env: IAdminEnv,
    cxt: ActivityContext<IAdminEnv>,
  ): Promise<UpdateRoleResponse> {
    await getRequestScope(cxt).get(Tokens.TeamService).updateMemberRole(request.teamId, request.userEmail, request.role);
    return { success: true, message: 'Role updated.' };
  }
}

interface UpdateRoleRequest extends IRequest {
  teamId: string;
  userEmail: string;
  role: string;
}
interface UpdateRoleResponse extends IResponse {
  success: boolean;
  message: string;
}
export { UpdateTeamMemberRoleRoute };
