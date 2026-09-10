import { TeamAccountsDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

class AddTeamAccountRoute extends IAdminActivityAPIRoute<AddTeamAccountRequest, AddTeamAccountResponse, IAdminEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Add Account to Team',
    description:
      'Associates an AWS account with a team. Team members will be able to see and access roles in this account according to their individual access grants. Teams scope access at the account level — credentials are shared resources.',
    requestBody: {
      description: 'Account to associate with the team',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['teamId', 'awsAccountId'],
            properties: {
              teamId: {
                type: 'string' as const,
                format: 'uuid',
                description: 'Team to add the account to',
                example: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
              },
              awsAccountId: {
                type: 'string' as const,
                pattern: '^\\d{12}$',
                description: 'AWS Account ID to associate with the team (12 digits)',
                example: '123456789012',
              },
            },
          },
          examples: {
            'add-account': {
              summary: 'Add an AWS account to a team',
              value: { teamId: 'b2c3d4e5-f6a7-8901-bcde-f23456789012', awsAccountId: '123456789012' },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Account added to team successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: { type: 'boolean' as const, example: true },
                message: { type: 'string' as const, example: 'Account added to team.' },
              },
            },
            examples: {
              added: {
                summary: 'Account added',
                value: { success: true, message: 'Account added to team.' },
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
        description: 'Internal server error while adding account to team',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to add account to team.' },
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

  protected async handleAdminRequest(request: AddTeamAccountRequest, env: IAdminEnv): Promise<AddTeamAccountResponse> {
    if (!request.teamId || !request.awsAccountId) throw new BadRequestError('Missing required fields.');
    await new TeamAccountsDAO(env.AccessBridgeDB).addAccountToTeam(request.teamId, request.awsAccountId);
    return { success: true, message: 'Account added to team.' };
  }
}

interface AddTeamAccountRequest extends IRequest {
  teamId: string;
  awsAccountId: string;
}
interface AddTeamAccountResponse extends IResponse {
  success: boolean;
  message: string;
}
export { AddTeamAccountRoute };
