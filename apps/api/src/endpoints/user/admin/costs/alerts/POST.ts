import { SpendAlertDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import type { SpendAlert } from '@/model';

class CreateSpendAlertRoute extends IAdminActivityAPIRoute<CreateSpendAlertRequest, CreateSpendAlertResponse, IAdminEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Create Spend Alert',
    description:
      'Creates a configurable spend alert for an AWS account. When the account spend exceeds the configured threshold amount within the specified period (daily or monthly), the alert is triggered. Alerts are evaluated against cost data collected by the background CostDataCollectionTask.',
    requestBody: {
      description: 'Spend alert configuration',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['awsAccountId', 'thresholdAmount'],
            properties: {
              awsAccountId: {
                type: 'string' as const,
                pattern: '^\\d{12}$',
                description: 'AWS Account ID to monitor (12 digits)',
                example: '123456789012',
              },
              thresholdAmount: {
                type: 'number' as const,
                minimum: 0,
                description: 'Spend threshold in USD that triggers the alert',
                example: 500.0,
              },
              periodType: {
                type: 'string' as const,
                enum: ['daily', 'monthly'],
                default: 'monthly',
                description: 'Period over which to evaluate spend against the threshold',
              },
            },
          },
          examples: {
            'monthly-alert': {
              summary: 'Monthly spend alert',
              value: { awsAccountId: '123456789012', thresholdAmount: 1000.0, periodType: 'monthly' },
            },
            'daily-alert': {
              summary: 'Daily spend alert',
              value: { awsAccountId: '987654321098', thresholdAmount: 50.0, periodType: 'daily' },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Spend alert created successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: { type: 'boolean' as const, description: 'Indicates the operation completed successfully' },
                alert: {
                  type: 'object' as const,
                  description: 'The created spend alert',
                  properties: {
                    id: { type: 'string' as const, description: 'Unique alert ID' },
                    awsAccountId: { type: 'string' as const },
                    thresholdAmount: { type: 'number' as const },
                    periodType: { type: 'string' as const },
                    createdBy: { type: 'string' as const, description: 'Email of the admin who created the alert' },
                    createdAt: { type: 'integer' as const, description: 'Unix timestamp of creation' },
                  },
                },
              },
            },
            examples: {
              'created-alert': {
                summary: 'Successfully created alert',
                value: {
                  success: true,
                  alert: {
                    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                    awsAccountId: '123456789012',
                    thresholdAmount: 1000.0,
                    periodType: 'monthly',
                    createdBy: 'admin@example.com',
                    createdAt: 1704067200,
                  },
                },
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
                    Message: { type: 'string' as const, example: 'Missing required fields: awsAccountId and thresholdAmount.' },
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
        description: 'Internal server error while creating spend alert',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to create spend alert.' },
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

  protected async handleAdminRequest(
    request: CreateSpendAlertRequest,
    env: IAdminEnv,
    cxt: ActivityContext<IAdminEnv>,
  ): Promise<CreateSpendAlertResponse> {
    if (!request.awsAccountId || !request.thresholdAmount) {
      throw new BadRequestError('Missing required fields: awsAccountId and thresholdAmount.');
    }
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const spendAlertDAO: SpendAlertDAO = new SpendAlertDAO(env.AccessBridgeDB);
    const alert: SpendAlert = await spendAlertDAO.createAlert(
      request.awsAccountId,
      request.thresholdAmount,
      request.periodType || 'monthly',
      userEmail,
    );
    return { success: true, alert };
  }
}

interface CreateSpendAlertRequest extends IRequest {
  awsAccountId: string;
  thresholdAmount: number;
  periodType?: string;
}

interface CreateSpendAlertResponse extends IResponse {
  success: boolean;
  alert: SpendAlert;
}

export { CreateSpendAlertRoute };
