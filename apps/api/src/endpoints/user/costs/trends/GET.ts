import { CostServiceFactory } from '@aws-access-bridge/backend-services/cost';
import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';

class GetCostTrendsRoute extends IActivityAPIRoute<GetCostTrendsRequest, GetCostTrendsResponse, GetCostTrendsEnv> {
  schema = {
    tags: ['Cost'],
    summary: 'Get Cost Trends',
    description:
      'Returns monthly cost totals across all accounts the user has access to, suitable for rendering trend charts. Each month includes the total spend and a per-account breakdown. Data is sorted chronologically.',
    parameters: [
      {
        name: 'months',
        in: 'query' as const,
        required: false,
        description: 'Number of months of trend data to return (max 12, default 6)',
        schema: { type: 'integer' as const, minimum: 1, maximum: 12, default: 6 },
      },
    ],
    responses: {
      '200': {
        description: 'Monthly cost trend data sorted chronologically',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                months: {
                  type: 'array' as const,
                  items: {
                    type: 'object' as const,
                    properties: {
                      period: { type: 'string' as const, description: 'Month period in YYYY-MM format' },
                      total: { type: 'number' as const, description: 'Total spend across all accounts for this month' },
                      byAccount: {
                        type: 'object' as const,
                        description: 'Spend per AWS Account ID for this month',
                        additionalProperties: { type: 'number' as const },
                      },
                    },
                  },
                },
              },
            },
            examples: {
              'trend-data': {
                summary: 'Six months of cost trends',
                value: {
                  months: [
                    { period: '2024-01', total: 2150, byAccount: { '123456789012': 1200, '987654321098': 950 } },
                    { period: '2024-02', total: 2340.5, byAccount: { '123456789012': 1300.5, '987654321098': 1040 } },
                    { period: '2024-03', total: 1980.25, byAccount: { '123456789012': 1100.25, '987654321098': 880 } },
                  ],
                },
              },
              'no-data': {
                summary: 'No cost data available',
                value: { months: [] },
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
      '500': {
        description: 'Internal server error while fetching cost trends',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to retrieve cost trends.' },
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
    _request: GetCostTrendsRequest,
    env: GetCostTrendsEnv,
    cxt: ActivityContext<GetCostTrendsEnv>,
  ): Promise<GetCostTrendsResponse> {
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const url: URL = new URL(cxt.req.url);
    const months: number = Math.min(parseInt(url.searchParams.get('months') || '6'), 12);
    return CostServiceFactory.create(env).getTrends(userEmail, months);
  }
}

type GetCostTrendsRequest = IRequest;

interface GetCostTrendsResponse extends IResponse {
  months: Array<{ period: string; total: number; byAccount: Record<string, number> }>;
}

type GetCostTrendsEnv = IEnv;

export { GetCostTrendsRoute };
