import { AuditServiceFactory } from '@aws-access-bridge/backend-services/audit';
import type { AuditLogQueryFilters } from '@aws-access-bridge/backend-data/dao';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import type { AuditLog } from '@aws-access-bridge/shared/model';

class ListAuditLogsRoute extends IAdminActivityAPIRoute<ListAuditLogsRequest, ListAuditLogsResponse, ListAuditLogsEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Query Audit Logs',
    description:
      'Query audit logs with optional filters for user email, action type, and time range. Results are paginated. All API requests are automatically logged, and this endpoint allows administrators to search and review that activity history.',
    parameters: [
      {
        name: 'userEmail',
        in: 'query' as const,
        required: false,
        description: 'Filter logs by user email address (exact match)',
        schema: { type: 'string' as const, example: 'user@example.com' },
      },
      {
        name: 'action',
        in: 'query' as const,
        required: false,
        description: 'Filter logs by action type (e.g., ASSUME_ROLE, GRANT_ACCESS, REVOKE_ACCESS)',
        schema: { type: 'string' as const, example: 'ASSUME_ROLE' },
      },
      {
        name: 'startTime',
        in: 'query' as const,
        required: false,
        description: 'Filter logs after this Unix timestamp (seconds)',
        schema: { type: 'integer' as const, example: 1_704_067_200 },
      },
      {
        name: 'endTime',
        in: 'query' as const,
        required: false,
        description: 'Filter logs before this Unix timestamp (seconds)',
        schema: { type: 'integer' as const, example: 1_704_153_600 },
      },
      {
        name: 'limit',
        in: 'query' as const,
        required: false,
        description: 'Maximum number of log entries to return per page',
        schema: { type: 'integer' as const, minimum: 1, maximum: 200, default: 50 },
      },
      {
        name: 'offset',
        in: 'query' as const,
        required: false,
        description: 'Number of log entries to skip for pagination',
        schema: { type: 'integer' as const, minimum: 0, default: 0 },
      },
    ],
    responses: {
      '200': {
        description: 'Paginated audit log results',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                logs: {
                  type: 'array' as const,
                  items: {
                    type: 'object' as const,
                    properties: {
                      id: { type: 'integer' as const, description: 'Unique audit log entry ID' },
                      userEmail: { type: 'string' as const, description: 'Email of the user who performed the action' },
                      action: { type: 'string' as const, description: 'Semantic action name (e.g., ASSUME_ROLE)' },
                      method: { type: 'string' as const, description: 'HTTP method of the request' },
                      path: { type: 'string' as const, description: 'API path that was called' },
                      statusCode: { type: 'integer' as const, description: 'HTTP response status code' },
                      ipAddress: { type: 'string' as const, description: 'Client IP address' },
                      userAgent: { type: 'string' as const, description: 'Client User-Agent header' },
                      timestamp: { type: 'integer' as const, description: 'Unix timestamp when the action occurred' },
                    },
                  },
                },
                total: { type: 'integer' as const, description: 'Total number of matching log entries' },
              },
            },
            examples: {
              'with-results': {
                summary: 'Audit logs with results',
                value: {
                  logs: [
                    {
                      id: 42,
                      userEmail: 'admin@example.com',
                      action: 'ASSUME_ROLE',
                      method: 'POST',
                      path: '/user/aws/assume-role',
                      statusCode: 200,
                      ipAddress: '203.0.113.1',
                      userAgent: 'Mozilla/5.0',
                      timestamp: 1_704_067_200,
                    },
                    {
                      id: 41,
                      userEmail: 'dev@example.com',
                      action: 'GRANT_ACCESS',
                      method: 'POST',
                      path: '/user/admin/access',
                      statusCode: 200,
                      ipAddress: '198.51.100.5',
                      userAgent: 'Mozilla/5.0',
                      timestamp: 1_704_066_000,
                    },
                  ],
                  total: 128,
                },
              },
              'empty-results': {
                summary: 'No matching audit logs',
                value: { logs: [], total: 0 },
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
        description: 'Internal server error while querying audit logs',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to query audit logs.' },
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
    request: ListAuditLogsRequest,
    env: ListAuditLogsEnv,
    cxt: ActivityContext<ListAuditLogsEnv>,
  ): Promise<ListAuditLogsResponse> {
    const url: URL = new URL(cxt.req.url);
    const filters: AuditLogQueryFilters = {
      userEmail: url.searchParams.get('userEmail') || undefined,
      action: url.searchParams.get('action') || undefined,
      startTime: url.searchParams.get('startTime') ? parseInt(url.searchParams.get('startTime')!) : undefined,
      endTime: url.searchParams.get('endTime') ? parseInt(url.searchParams.get('endTime')!) : undefined,
    };
    const limit: number = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50'), 1), 200);
    const offset: number = Math.max(parseInt(url.searchParams.get('offset') || '0'), 0);

    const auditService = AuditServiceFactory.create(env);
    const { logs, total } = await auditService.queryLogs(filters, limit, offset);
    return { logs, total };
  }
}

type ListAuditLogsRequest = IRequest;

interface ListAuditLogsResponse extends IResponse {
  logs: AuditLog[];
  total: number;
}

type ListAuditLogsEnv = IAdminEnv;

export { ListAuditLogsRoute };
