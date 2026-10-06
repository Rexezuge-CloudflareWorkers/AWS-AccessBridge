
import type { ActivityContext } from '@/endpoints/IAdminActivityAPIRoute';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { badRequestResponse, forbiddenResponse, internalServerErrorResponse, unauthorizedResponse } from '@aws-access-bridge/shared/schema/exceptionResponses';
class DeleteSpendAlertRoute extends IAdminActivityAPIRoute<DeleteSpendAlertRequest, DeleteSpendAlertResponse, IAdminEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Delete Spend Alert',
    description: 'Deletes a previously configured spend alert by its ID. The alert will no longer be evaluated against incoming cost data.',
    requestBody: {
      description: 'Alert to delete',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['alertId'],
            properties: {
              alertId: {
                type: 'string' as const,
                format: 'uuid',
                description: 'Unique identifier of the spend alert to delete',
                example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              },
            },
          },
          examples: {
            'delete-alert': {
              summary: 'Delete a spend alert',
              value: { alertId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Spend alert deleted successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: { type: 'boolean' as const, example: true },
                message: { type: 'string' as const, example: 'Alert deleted.' },
              },
            },
            examples: {
              deleted: {
                summary: 'Alert deleted successfully',
                value: { success: true, message: 'Alert deleted.' },
              },
            },
          },
        },
      },
      '400': badRequestResponse('Bad request - Missing required field'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid authentication'),
      '403': forbiddenResponse('Forbidden - User is not a superadmin'),
      '500': internalServerErrorResponse('Internal server error while deleting spend alert'),
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleAdminRequest(request: DeleteSpendAlertRequest, env: IAdminEnv,
    cxt: ActivityContext<IAdminEnv>): Promise<DeleteSpendAlertResponse> {
    await getRequestScope(cxt).get(Tokens.CostService).deleteAlert(request.alertId);
    return { success: true, message: 'Alert deleted.' };
  }
}

interface DeleteSpendAlertRequest extends IRequest {
  alertId: string;
}
interface DeleteSpendAlertResponse extends IResponse {
  success: boolean;
  message: string;
}

export { DeleteSpendAlertRoute };
