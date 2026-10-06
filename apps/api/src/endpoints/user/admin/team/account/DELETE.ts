
import type { ActivityContext } from '@/endpoints/IAdminActivityAPIRoute';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { badRequestResponse, forbiddenResponse, internalServerErrorResponse, unauthorizedResponse } from '@aws-access-bridge/shared/schema/exceptionResponses';
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
                pattern: String.raw`^\d{12}$`,
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
      '400': badRequestResponse('Bad request - Missing required fields'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid authentication'),
      '403': forbiddenResponse('Forbidden - User is not a superadmin'),
      '500': internalServerErrorResponse('Internal server error while removing account from team'),
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleAdminRequest(request: RemoveTeamAccountRequest, env: IAdminEnv,
    cxt: ActivityContext<IAdminEnv>): Promise<RemoveTeamAccountResponse> {
    await getRequestScope(cxt).get(Tokens.TeamService).removeAccount(request.teamId, request.awsAccountId);
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
