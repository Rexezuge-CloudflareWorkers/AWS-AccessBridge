import { TeamAccountsDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

class RemoveTeamAccountRoute extends IAdminActivityAPIRoute<RemoveTeamAccountRequest, RemoveTeamAccountResponse, IAdminEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Remove Account from Team',
    description:
      'Removes the association between an AWS account and a team. Team members will no longer see this account scoped to the team. The AWS account and its credentials are not deleted.',
    requestBody: {
      description: 'Account to dissociate from the team',
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
                description: 'Team to remove the account from',
                example: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
              },
              awsAccountId: {
                type: 'string' as const,
                pattern: '^\\d{12}$',
                description: 'AWS Account ID to remove from the team (12 digits)',
                example: '123456789012',
              },
            },
          },
          examples: {
            'remove-account': {
              summary: 'Remove an AWS account from a team',
              value: { teamId: 'b2c3d4e5-f6a7-8901-bcde-f23456789012', awsAccountId: '123456789012' },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Account removed from team successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: { type: 'boolean' as const, example: true },
                message: { type: 'string' as const, example: 'Account removed from team.' },
              },
            },
            examples: {
              removed: {
                summary: 'Account removed',
                value: { success: true, message: 'Account removed from team.' },
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
        description: 'Internal server error while removing account from team',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to remove account from team.' },
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

  protected async handleAdminRequest(request: RemoveTeamAccountRequest, env: IAdminEnv): Promise<RemoveTeamAccountResponse> {
    if (!request.teamId || !request.awsAccountId) throw new BadRequestError('Missing required fields.');
    await new TeamAccountsDAO(env.AccessBridgeDB).removeAccountFromTeam(request.teamId, request.awsAccountId);
    return { success: true, message: 'Account removed from team.' };
  }
}

interface RemoveTeamAccountRequest extends IRequest {
  teamId: string;
  awsAccountId: string;
}
interface RemoveTeamAccountResponse extends IResponse {
  success: boolean;
  message: string;
}
export { RemoveTeamAccountRoute };
