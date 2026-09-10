import { TeamMembersDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

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
        description: 'Internal server error while adding team member',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to add team member.' },
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

  protected async handleAdminRequest(request: AddTeamMemberRequest, env: IAdminEnv): Promise<AddTeamMemberResponse> {
    if (!request.teamId || !request.userEmail) throw new BadRequestError('Missing required fields.');
    await new TeamMembersDAO(env.AccessBridgeDB).addMember(request.teamId, request.userEmail, request.role || 'member');
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
