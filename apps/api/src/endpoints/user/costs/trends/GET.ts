import { AssumableRolesDAO, CostDataDAO } from '@/dao';
import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import type { CostData } from '@/model';

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
                    { period: '2024-01', total: 2150.0, byAccount: { '123456789012': 1200.0, '987654321098': 950.0 } },
                    { period: '2024-02', total: 2340.5, byAccount: { '123456789012': 1300.5, '987654321098': 1040.0 } },
                    { period: '2024-03', total: 1980.25, byAccount: { '123456789012': 1100.25, '987654321098': 880.0 } },
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

    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(env.AccessBridgeDB);
    const accountIds: string[] = await assumableRolesDAO.getDistinctAccountIds(userEmail);

    if (accountIds.length === 0) return { months: [] };

    const endDate: string = new Date().toISOString().split('T')[0];
    const startDate: string = new Date(Date.now() - months * 30 * 86400000).toISOString().split('T')[0];

    const costDataDAO: CostDataDAO = new CostDataDAO(env.AccessBridgeDB);
    const costData: CostData[] = await costDataDAO.getCostDataForAccounts(accountIds, startDate, endDate);

    // Aggregate by month
    const monthlyData: Record<string, { total: number; byAccount: Record<string, number> }> = {};
    for (const data of costData) {
      const month: string = data.periodStart.substring(0, 7); // YYYY-MM
      if (!monthlyData[month]) monthlyData[month] = { total: 0, byAccount: {} };
      monthlyData[month].total += data.totalCost;
      monthlyData[month].byAccount[data.awsAccountId] = (monthlyData[month].byAccount[data.awsAccountId] || 0) + data.totalCost;
    }

    const result = Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, data]) => ({
        period,
        total: Math.round(data.total * 100) / 100,
        byAccount: data.byAccount,
      }));

    return { months: result };
  }
}

type GetCostTrendsRequest = IRequest;

interface GetCostTrendsResponse extends IResponse {
  months: Array<{ period: string; total: number; byAccount: Record<string, number> }>;
}

type GetCostTrendsEnv = IEnv;

export { GetCostTrendsRoute };
