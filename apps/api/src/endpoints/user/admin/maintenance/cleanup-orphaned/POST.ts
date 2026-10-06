import { type OrphanCleanupResult } from '@aws-access-bridge/backend-services/maintenance';

import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { forbiddenResponse, internalServerErrorResponse, unauthorizedResponse } from '@aws-access-bridge/shared/schema/exceptionResponses';
import { log } from '@aws-access-bridge/shared/utils';
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
      '401': unauthorizedResponse('Unauthorized - Missing or invalid authentication'),
      '403': forbiddenResponse('Forbidden - User is not a superadmin'),
      '500': internalServerErrorResponse('Internal server error during cleanup'),
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleAdminRequest(
    _request: CleanupOrphanedDataRequest,
    env: CleanupOrphanedDataEnv,
    _cxt: ActivityContext<CleanupOrphanedDataEnv>,
  ): Promise<CleanupOrphanedDataResponse> {
    const result: OrphanCleanupResult = await getRequestScope(_cxt).get(Tokens.MaintenanceService).cleanupOrphanedData();
    // A partial run still answers 200, with the failures named. Throwing here would
    // tell the administrator nothing happened, when six of the seven tables were in
    // fact cleaned — the next run would retry the whole thing either way.
    if (result.failures.length > 0) {
      log.warn(`Orphan cleanup completed with ${result.failures.length} failed table(s)`, { failedTables: result.failures });
    }
    return { deletedCounts: result.deletedCounts, totalDeleted: result.totalDeleted, failures: result.failures };
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
  /**
   * Tables whose delete failed, with the reason. Empty on a clean run.
   *
   * The seven deletes are settled independently, so a failure in one does not abort
   * the rest — this is how the caller learns which part did not happen.
   */
  failures: Array<{ table: keyof DeletedCounts; error: string }>;
}

interface CleanupOrphanedDataEnv extends IAdminEnv {
  AccessBridgeDB: D1DatabaseSession;
}

export { CleanupOrphanedDataRoute };
