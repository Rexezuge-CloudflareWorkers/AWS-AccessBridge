import { SpendAlertDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

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
      '400': {
        description: 'Bad request - Missing required field',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'BadRequestError' },
                    Message: { type: 'string' as const, example: 'Missing required field: alertId.' },
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
        description: 'Internal server error while deleting spend alert',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to delete spend alert.' },
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

  protected async handleAdminRequest(request: DeleteSpendAlertRequest, env: IAdminEnv): Promise<DeleteSpendAlertResponse> {
    if (!request.alertId) throw new BadRequestError('Missing required field: alertId.');
    const spendAlertDAO: SpendAlertDAO = new SpendAlertDAO(env.AccessBridgeDB);
    await spendAlertDAO.deleteAlert(request.alertId);
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
