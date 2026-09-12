import { MaintenanceServiceFactory, type OrphanCleanupResult } from '@aws-access-bridge/backend-services/maintenance';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

class CleanupOrphanedDataRoute extends IAdminActivityAPIRoute<
  CleanupOrphanedDataRequest,
  CleanupOrphanedDataResponse,
  CleanupOrphanedDataEnv
> {
  schema = {
    tags: ['Admin'],
    summary: 'Cleanup Orphaned Data',
    description:
      'Deletes rows in satellite tables whose parent entity no longer exists. An AWS account is treated as active only if it appears in assumable_roles (has at least one user grant). Returns per-table deletion counts.',
    responses: {
      '200': {
        description: 'Per-table deletion counts',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                deletedCounts: {
                  type: 'object' as const,
                  properties: {
                    dataCollectionConfig: { type: 'integer' as const },
                    roleConfigs: { type: 'integer' as const },
                    teamAccounts: { type: 'integer' as const },
                    spendAlerts: { type: 'integer' as const },
                    costData: { type: 'integer' as const },
                    resourceInventory: { type: 'integer' as const },
                    awsAccounts: { type: 'integer' as const },
                  },
                },
                totalDeleted: { type: 'integer' as const },
              },
            },
            examples: {
              'no-orphans': {
                summary: 'Nothing to clean up',
                value: {
                  deletedCounts: {
                    dataCollectionConfig: 0,
                    roleConfigs: 0,
                    teamAccounts: 0,
                    spendAlerts: 0,
                    costData: 0,
                    resourceInventory: 0,
                    awsAccounts: 0,
                  },
                  totalDeleted: 0,
                },
              },
              'cleaned-up': {
                summary: 'Orphaned rows removed',
                value: {
                  deletedCounts: {
                    dataCollectionConfig: 1,
                    roleConfigs: 2,
                    teamAccounts: 0,
                    spendAlerts: 1,
                    costData: 30,
                    resourceInventory: 14,
                    awsAccounts: 1,
                  },
                  totalDeleted: 49,
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
        description: 'Internal server error during cleanup',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to clean up orphaned data.' },
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
    _request: CleanupOrphanedDataRequest,
    env: CleanupOrphanedDataEnv,
    _cxt: ActivityContext<CleanupOrphanedDataEnv>,
  ): Promise<CleanupOrphanedDataResponse> {
    const result: OrphanCleanupResult = await MaintenanceServiceFactory.create(env).cleanupOrphanedData();
    return { deletedCounts: result.deletedCounts, totalDeleted: result.totalDeleted };
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface CleanupOrphanedDataRequest extends IRequest {}

interface DeletedCounts {
  dataCollectionConfig: number;
  roleConfigs: number;
  teamAccounts: number;
  spendAlerts: number;
  costData: number;
  resourceInventory: number;
  awsAccounts: number;
}

interface CleanupOrphanedDataResponse extends IResponse {
  deletedCounts: DeletedCounts;
  totalDeleted: number;
}

interface CleanupOrphanedDataEnv extends IAdminEnv {
  AccessBridgeDB: D1DatabaseSession;
}

export { CleanupOrphanedDataRoute };
