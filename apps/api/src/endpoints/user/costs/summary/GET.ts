
import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

class GetCostSummaryRoute extends IActivityAPIRoute<GetCostSummaryRequest, GetCostSummaryResponse, GetCostSummaryEnv> {
  schema = {
    tags: ['Cost'],
    summary: 'Get Cost Summary',
    description:
      'Returns aggregated cost summary across all AWS accounts the user has access to, covering the last 30 days. Each account shows its total cost and currency, plus a grand total across all accounts. Requires cost data collection to be enabled for the relevant credentials.',
    responses: {
      '200': {
        description: 'Aggregated cost summary by account',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                accounts: {
                  type: 'object' as const,
                  description: 'Cost data keyed by AWS Account ID',
                  additionalProperties: {
                    type: 'object' as const,
                    properties: {
                      totalCost: { type: 'number' as const, description: 'Total cost for this account over the last 30 days' },
                      currency: { type: 'string' as const, description: 'Currency code (typically USD)' },
                    },
                  },
                },
                grandTotal: { type: 'number' as const, description: 'Sum of all account costs, rounded to 2 decimal places' },
                currency: {
                  type: 'string' as const,
                  nullable: true,
                  description:
                    "Currency the grand total is denominated in, or null when the accounts do not all share one. Null means the sum spans currencies and no symbol should be shown.",
                },
              },
            },
            examples: {
              'multiple-accounts': {
                summary: 'Cost summary across multiple accounts',
                value: {
                  accounts: {
                    '123456789012': { totalCost: 1542.37, currency: 'USD' },
                    '987654321098': { totalCost: 823.15, currency: 'USD' },
                  },
                  grandTotal: 2365.52,
                  currency: 'USD',
                },
              },
              'mixed-currency': {
                summary: 'Accounts reporting different currencies',
                value: {
                  accounts: {
                    '123456789012': { totalCost: 1542.37, currency: 'USD' },
                    '987654321098': { totalCost: 823.15, currency: 'EUR' },
                  },
                  grandTotal: 2365.52,
                  currency: null,
                },
              },
              'no-access': {
                summary: 'User has no accessible accounts',
                value: { accounts: {}, grandTotal: 0, currency: null },
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
                    Message: { type: 'string' as const, example: 'Failed to retrieve cost summary.' },
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
    _request: GetCostSummaryRequest,
    env: GetCostSummaryEnv,
    cxt: ActivityContext<GetCostSummaryEnv>,
  ): Promise<GetCostSummaryResponse> {
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    return getRequestScope(cxt).get(Tokens.CostService).getSummary(userEmail);
  }
}

type GetCostSummaryRequest = IRequest;

interface GetCostSummaryResponse extends IResponse {
  accounts: Record<string, { totalCost: number; currency: string }>;
  grandTotal: number;
  currency: string | null;
}

type GetCostSummaryEnv = IEnv;

export { GetCostSummaryRoute };
