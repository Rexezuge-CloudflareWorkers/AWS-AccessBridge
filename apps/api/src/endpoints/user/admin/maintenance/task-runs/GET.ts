import { BackgroundTaskRunDAO } from '@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import type { BackgroundTaskRun } from '@aws-access-bridge/shared/model';

class ListTaskRunsRoute extends IAdminActivityAPIRoute<ListTaskRunsRequest, ListTaskRunsResponse, ListTaskRunsEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Query Background Task Runs',
    description:
      'Query background task run history with optional filters for task type and status. Cron tasks record a run entry on every execution via the scheduled task framework.',
    parameters: [
      {
        name: 'taskType',
        in: 'query' as const,
        required: false,
        description: 'Filter runs by task type (e.g., credential-cache-refresh, cost-data-collection)',
        schema: { type: 'string' as const, example: 'cost-data-collection' },
      },
      {
        name: 'status',
        in: 'query' as const,
        required: false,
        description: 'Filter runs by status (running, success, partial_success, error, skipped)',
        schema: { type: 'string' as const, example: 'error' },
      },
      {
        name: 'limit',
        in: 'query' as const,
        required: false,
        description: 'Maximum number of run entries to return',
        schema: { type: 'integer' as const, minimum: 1, maximum: 200, default: 50 },
      },
    ],
    responses: {
      '200': {
        description: 'Background task run history',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                runs: {
                  type: 'array' as const,
                  items: {
                    type: 'object' as const,
                    properties: {
                      runId: { type: 'string' as const, description: 'Unique run ID' },
                      taskType: { type: 'string' as const, description: 'Task type identifier' },
                      status: { type: 'string' as const, description: 'Run status' },
                      itemsProcessed: { type: 'integer' as const, description: 'Number of items processed' },
                      itemsFailed: { type: 'integer' as const, description: 'Number of items that failed' },
                      summary: { type: 'string' as const, description: 'Human-readable run summary' },
                      errorMessage: { type: 'string' as const, description: 'Error message when status is error' },
                      startedAt: { type: 'integer' as const, description: 'Unix timestamp when the run started' },
                      completedAt: { type: 'integer' as const, description: 'Unix timestamp when the run completed' },
                    },
                  },
                },
              },
            },
            examples: {
              'with-results': {
                summary: 'Task runs with results',
                value: {
                  runs: [
                    {
                      runId: 'c5b5f2c0-7e9a-4e3b-9c1d-2f6a8b4d0e12',
                      taskType: 'cost-data-collection',
                      status: 'success',
                      itemsProcessed: 3,
                      itemsFailed: 0,
                      summary: 'Collected cost data for 3 accounts (0 failed)',
                      errorMessage: null,
                      startedAt: 1_704_067_200,
                      completedAt: 1_704_067_260,
                    },
                  ],
                },
              },
              'empty-results': {
                summary: 'No task runs recorded yet',
                value: { runs: [] },
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
        description: 'Internal server error while querying task runs',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to query task runs.' },
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
    request: ListTaskRunsRequest,
    env: ListTaskRunsEnv,
    cxt: ActivityContext<ListTaskRunsEnv>,
  ): Promise<ListTaskRunsResponse> {
    const url: URL = new URL(cxt.req.url);
    const taskType: string | undefined = url.searchParams.get('taskType') || undefined;
    const status: string | undefined = url.searchParams.get('status') || undefined;
    const limit: number = Math.min(Math.max(Number(url.searchParams.get('limit') || '50'), 1), 200);

    const backgroundTaskRunDAO: BackgroundTaskRunDAO = new BackgroundTaskRunDAO(env.AccessBridgeDB);
    const runs: BackgroundTaskRun[] = await backgroundTaskRunDAO.listRuns({ taskType, status, limit });
    return { runs };
  }
}

type ListTaskRunsRequest = IRequest;

interface ListTaskRunsResponse extends IResponse {
  runs: BackgroundTaskRun[];
}

type ListTaskRunsEnv = IAdminEnv;

export { ListTaskRunsRoute };
