import { TeamMembersDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

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
      '400': {
        description: 'Bad request - Missing required fields',
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
        description: 'Internal server error while updating role',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to update team member role.' },
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

  protected async handleAdminRequest(request: UpdateRoleRequest, env: IAdminEnv): Promise<UpdateRoleResponse> {
    if (!request.teamId || !request.userEmail || !request.role) throw new BadRequestError('Missing required fields.');
    await new TeamMembersDAO(env.AccessBridgeDB).updateMemberRole(request.teamId, request.userEmail, request.role);
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
