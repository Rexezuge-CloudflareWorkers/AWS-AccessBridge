import { AssumableRolesDAO, CostDataDAO } from '@/dao';
import { BadRequestError, ForbiddenError } from '@/error';
import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import type { CostData } from '@/model';

class GetAccountCostRoute extends IActivityAPIRoute<GetAccountCostRequest, GetAccountCostResponse, GetAccountCostEnv> {
  schema = {
    tags: ['Cost'],
    summary: 'Get Account Cost Detail',
    description:
      'Returns daily cost breakdown for a specific AWS account, including per-service spend. The user must have access to the account via an assumable role. Defaults to the last 30 days if no date range is specified.',
    parameters: [
      {
        name: 'awsAccountId',
        in: 'query' as const,
        required: true,
        description: 'AWS Account ID to retrieve cost data for (12 digits)',
        schema: { type: 'string' as const, pattern: '^\\d{12}$', example: '123456789012' },
      },
      {
        name: 'startDate',
        in: 'query' as const,
        required: false,
        description: 'Start date for the cost period (ISO 8601 date, defaults to 30 days ago)',
        schema: { type: 'string' as const, format: 'date', example: '2024-01-01' },
      },
      {
        name: 'endDate',
        in: 'query' as const,
        required: false,
        description: 'End date for the cost period (ISO 8601 date, defaults to today)',
        schema: { type: 'string' as const, format: 'date', example: '2024-01-31' },
      },
    ],
    responses: {
      '200': {
        description: 'Daily cost breakdown with service-level detail',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                awsAccountId: { type: 'string' as const, description: 'AWS Account ID' },
                dailyCosts: {
                  type: 'array' as const,
                  description: 'Daily cost entries for the requested period',
                  items: {
                    type: 'object' as const,
                    properties: {
                      awsAccountId: { type: 'string' as const },
                      periodStart: { type: 'string' as const, description: 'Date of the cost entry (YYYY-MM-DD)' },
                      totalCost: { type: 'number' as const, description: 'Total cost for this day' },
                      currency: { type: 'string' as const },
                      serviceBreakdown: {
                        type: 'object' as const,
                        description: 'Cost per AWS service for this day',
                        additionalProperties: { type: 'number' as const },
                      },
                    },
                  },
                },
                serviceBreakdown: {
                  type: 'object' as const,
                  description: 'Aggregated cost per AWS service over the entire period',
                  additionalProperties: { type: 'number' as const },
                },
                total: { type: 'number' as const, description: 'Total cost over the entire period, rounded to 2 decimal places' },
              },
            },
            examples: {
              'account-costs': {
                summary: 'Account cost breakdown',
                value: {
                  awsAccountId: '123456789012',
                  dailyCosts: [
                    {
                      awsAccountId: '123456789012',
                      periodStart: '2024-01-15',
                      totalCost: 48.52,
                      currency: 'USD',
                      serviceBreakdown: { 'Amazon EC2': 32.1, 'Amazon S3': 8.42, 'AWS Lambda': 8.0 },
                    },
                    {
                      awsAccountId: '123456789012',
                      periodStart: '2024-01-16',
                      totalCost: 51.23,
                      currency: 'USD',
                      serviceBreakdown: { 'Amazon EC2': 35.0, 'Amazon S3': 8.23, 'AWS Lambda': 8.0 },
                    },
                  ],
                  serviceBreakdown: { 'Amazon EC2': 67.1, 'Amazon S3': 16.65, 'AWS Lambda': 16.0 },
                  total: 99.75,
                },
              },
            },
          },
        },
      },
      '400': {
        description: 'Bad request - Missing required parameter',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'BadRequestError' },
                    Message: { type: 'string' as const, example: 'Missing required parameter: awsAccountId.' },
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
        description: 'Forbidden - User does not have access to this account',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'ForbiddenError' },
                    Message: { type: 'string' as const, example: 'You do not have access to this account.' },
                  },
                },
              },
            },
          },
        },
      },
      '500': {
        description: 'Internal server error while fetching cost data',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to retrieve account cost data.' },
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

  protected async handleRequest(
    _request: GetAccountCostRequest,
    env: GetAccountCostEnv,
    cxt: ActivityContext<GetAccountCostEnv>,
  ): Promise<GetAccountCostResponse> {
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const url: URL = new URL(cxt.req.url);
    const awsAccountId: string | null = url.searchParams.get('awsAccountId');
    if (!awsAccountId) throw new BadRequestError('Missing required parameter: awsAccountId.');

    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(env.AccessBridgeDB);
    const roles: string[] = await assumableRolesDAO.getRolesByUserAndAccount(userEmail, awsAccountId);
    if (roles.length === 0) throw new ForbiddenError('You do not have access to this account.');

    const endDate: string = url.searchParams.get('endDate') || new Date().toISOString().split('T')[0];
    const startDate: string = url.searchParams.get('startDate') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    const costDataDAO: CostDataDAO = new CostDataDAO(env.AccessBridgeDB);
    const costData: CostData[] = await costDataDAO.getCostDataByAccount(awsAccountId, startDate, endDate);

    let total: number = 0;
    const serviceBreakdown: Record<string, number> = {};
    for (const data of costData) {
      total += data.totalCost;
      for (const [service, amount] of Object.entries(data.serviceBreakdown)) {
        serviceBreakdown[service] = (serviceBreakdown[service] || 0) + amount;
      }
    }

    return {
      awsAccountId,
      dailyCosts: costData,
      serviceBreakdown,
      total: Math.round(total * 100) / 100,
    };
  }
}

type GetAccountCostRequest = IRequest;

interface GetAccountCostResponse extends IResponse {
  awsAccountId: string;
  dailyCosts: CostData[];
  serviceBreakdown: Record<string, number>;
  total: number;
}

type GetAccountCostEnv = IEnv;

export { GetAccountCostRoute };
