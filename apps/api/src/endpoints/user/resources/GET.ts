import { AssumableRolesDAO, ResourceInventoryDAO } from '@/dao';
import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import type { ResourceInventoryItem } from '@/model';

class ListResourcesRoute extends IActivityAPIRoute<ListResourcesRequest, ListResourcesResponse, IEnv> {
  schema = {
    tags: ['Resources'],
    summary: 'List Resources',
    description:
      'Returns a paginated list of AWS resources (EC2 instances, S3 buckets, Lambda functions, RDS instances) with optional filters by type, account, and search term. Only shows resources in accounts the user has access to. Data is collected by the background ResourceInventoryCollectionTask.',
    parameters: [
      {
        name: 'type',
        in: 'query' as const,
        required: false,
        description: 'Filter by resource type (e.g., ec2, s3, lambda, rds, dynamodb)',
        schema: { type: 'string' as const, enum: ['ec2', 's3', 'lambda', 'rds', 'dynamodb'], example: 'ec2' },
      },
      {
        name: 'accountId',
        in: 'query' as const,
        required: false,
        description: 'Filter by AWS Account ID (must be an account the user has access to)',
        schema: { type: 'string' as const, pattern: '^\\d{12}$', example: '123456789012' },
      },
      {
        name: 'search',
        in: 'query' as const,
        required: false,
        description: 'Free-text search across resource names, IDs, and metadata',
        schema: { type: 'string' as const, example: 'web-server' },
      },
      {
        name: 'limit',
        in: 'query' as const,
        required: false,
        description: 'Maximum number of resources to return per page (max 200)',
        schema: { type: 'integer' as const, minimum: 1, maximum: 200, default: 50 },
      },
      {
        name: 'offset',
        in: 'query' as const,
        required: false,
        description: 'Number of resources to skip for pagination',
        schema: { type: 'integer' as const, minimum: 0, default: 0 },
      },
    ],
    responses: {
      '200': {
        description: 'Paginated list of resources matching the filters',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                items: {
                  type: 'array' as const,
                  items: {
                    type: 'object' as const,
                    properties: {
                      resourceId: { type: 'string' as const, description: 'AWS resource identifier' },
                      resourceType: { type: 'string' as const, description: 'Resource type (ec2, s3, lambda, rds)' },
                      resourceName: { type: 'string' as const, description: 'Resource name or identifier' },
                      awsAccountId: { type: 'string' as const, description: 'AWS Account ID the resource belongs to' },
                      region: { type: 'string' as const, description: 'AWS region where the resource is located' },
                      metadata: { type: 'object' as const, description: 'Additional resource-specific metadata' },
                      collectedAt: { type: 'integer' as const, description: 'Unix timestamp of when the resource was last collected' },
                    },
                  },
                },
                total: { type: 'integer' as const, description: 'Total number of resources matching the filters' },
                rolesByAccount: {
                  type: 'object' as const,
                  description: 'Assumable role names keyed by AWS account ID for opening resources in the console',
                },
              },
            },
            examples: {
              'ec2-instances': {
                summary: 'EC2 instances filtered by type',
                value: {
                  items: [
                    {
                      resourceId: 'i-0abc123def456789',
                      resourceType: 'ec2',
                      resourceName: 'web-server-01',
                      awsAccountId: '123456789012',
                      region: 'us-east-1',
                      metadata: { instanceType: 't3.medium', state: 'running' },
                      collectedAt: 1704067200,
                    },
                  ],
                  total: 12,
                  rolesByAccount: { '123456789012': ['DeveloperRole'] },
                },
              },
              'empty-results': {
                summary: 'No resources match the filters',
                value: { items: [], total: 0, rolesByAccount: {} },
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
        description: 'Internal server error while listing resources',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to list resources.' },
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

  protected async handleRequest(_request: ListResourcesRequest, env: IEnv, cxt: ActivityContext<IEnv>): Promise<ListResourcesResponse> {
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const url: URL = new URL(cxt.req.url);

    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(env.AccessBridgeDB);
    let accountIds: string[] = await assumableRolesDAO.getDistinctAccountIds(userEmail);

    const filterAccountId: string | null = url.searchParams.get('accountId');
    if (filterAccountId && accountIds.includes(filterAccountId)) {
      accountIds = [filterAccountId];
    }

    const resourceDAO: ResourceInventoryDAO = new ResourceInventoryDAO(env.AccessBridgeDB);
    const { items, total } = await resourceDAO.searchResources(
      accountIds,
      url.searchParams.get('search') || undefined,
      url.searchParams.get('type') || undefined,
      Math.min(parseInt(url.searchParams.get('limit') || '50'), 200),
      Math.max(parseInt(url.searchParams.get('offset') || '0'), 0),
    );
    const rolesByAccountEntries: Array<[string, string[]]> = await Promise.all(
      accountIds.map(
        async (accountId): Promise<[string, string[]]> => [
          accountId,
          await assumableRolesDAO.getRolesByUserAndAccount(userEmail, accountId),
        ],
      ),
    );

    return { items, total, rolesByAccount: Object.fromEntries(rolesByAccountEntries) };
  }
}

type ListResourcesRequest = IRequest;
interface ListResourcesResponse extends IResponse {
  items: ResourceInventoryItem[];
  total: number;
  rolesByAccount: Record<string, string[]>;
}

export { ListResourcesRoute };
