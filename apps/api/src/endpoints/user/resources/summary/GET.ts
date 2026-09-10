import { AssumableRolesDAO, ResourceInventoryDAO } from '@/dao';
import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';

class GetResourceSummaryRoute extends IActivityAPIRoute<GetResourceSummaryRequest, GetResourceSummaryResponse, IEnv> {
  schema = {
    tags: ['Resources'],
    summary: 'Get Resource Summary',
    description:
      'Returns resource counts grouped by type and by account for the authenticated user. Only includes resources in AWS accounts the user has access to. Used for rendering dashboard summary cards showing EC2 instances, S3 buckets, Lambda functions, and RDS instances.',
    responses: {
      '200': {
        description: 'Resource count summary by type and account',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                totalResources: { type: 'integer' as const, description: 'Total count of all resources across all accounts' },
                byType: {
                  type: 'object' as const,
                  description: 'Resource counts keyed by resource type (e.g., ec2, s3, lambda, rds)',
                  additionalProperties: { type: 'integer' as const },
                },
                byAccount: {
                  type: 'object' as const,
                  description: 'Resource counts keyed by AWS Account ID, each containing counts by type',
                  additionalProperties: {
                    type: 'object' as const,
                    additionalProperties: { type: 'integer' as const },
                  },
                },
              },
            },
            examples: {
              'resource-summary': {
                summary: 'Resource summary across accounts',
                value: {
                  totalResources: 47,
                  byType: { ec2: 12, s3: 20, lambda: 10, rds: 5 },
                  byAccount: {
                    '123456789012': { ec2: 8, s3: 15, lambda: 6, rds: 3 },
                    '987654321098': { ec2: 4, s3: 5, lambda: 4, rds: 2 },
                  },
                },
              },
              'no-resources': {
                summary: 'No resources found',
                value: { totalResources: 0, byType: {}, byAccount: {} },
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
        description: 'Internal server error while fetching resource summary',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to retrieve resource summary.' },
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
    _request: GetResourceSummaryRequest,
    env: IEnv,
    cxt: ActivityContext<IEnv>,
  ): Promise<GetResourceSummaryResponse> {
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(env.AccessBridgeDB);
    const accountIds: string[] = await assumableRolesDAO.getDistinctAccountIds(userEmail);

    const resourceDAO: ResourceInventoryDAO = new ResourceInventoryDAO(env.AccessBridgeDB);
    const counts: Record<string, Record<string, number>> = await resourceDAO.getResourceCounts(accountIds);

    let totalResources: number = 0;
    const byType: Record<string, number> = {};
    for (const accountCounts of Object.values(counts)) {
      for (const [type, count] of Object.entries(accountCounts)) {
        byType[type] = (byType[type] || 0) + count;
        totalResources += count;
      }
    }

    return { totalResources, byType, byAccount: counts };
  }
}

type GetResourceSummaryRequest = IRequest;
interface GetResourceSummaryResponse extends IResponse {
  totalResources: number;
  byType: Record<string, number>;
  byAccount: Record<string, Record<string, number>>;
}

export { GetResourceSummaryRoute };
