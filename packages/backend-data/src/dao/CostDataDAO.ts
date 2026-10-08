import type { CostData, CostDataInternal } from '@aws-access-bridge/shared/model';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import { BaseDAO } from './BaseDAO';
import { ORPHANED_BY_ASSUMABLE_ROLES } from './AwsAccountsDAO';
import { ownerClause } from './AssumableRolesQueries';
import type { AssumableRoleOwner } from './AssumableRolesDAO';

class CostDataDAO extends BaseDAO {
  public async upsertCostData(data: CostData): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT OR REPLACE INTO cost_data (aws_account_id, period_start, period_end, total_cost, currency, service_breakdown, collected_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            data.awsAccountId,
            data.periodStart,
            data.periodEnd,
            data.totalCost,
            data.currency,
            JSON.stringify(data.serviceBreakdown),
            TimestampUtil.getCurrentUnixTimestampInSeconds(),
          )
          .run(),
      'upsert cost data',
    );
  }

  public async getCostDataByAccount(awsAccountId: string, startDate: string, endDate: string): Promise<CostData[]> {
    const results = await this.database
      .prepare('SELECT * FROM cost_data WHERE aws_account_id = ? AND period_start >= ? AND period_start <= ? ORDER BY period_start ASC')
      .bind(awsAccountId, startDate, endDate)
      .all<CostDataInternal>();

    return (results.results || []).map((row) => CostDataDAO.mapToExternal(row));
  }

  /**
   * Costs across every account the caller may assume a role in.
   *
   * The account list is a subquery on `assumable_roles` rather than a bound
   * `IN (?,...)` list: D1 caps bound parameters per statement, so an auth
   * context spanning more than that many accounts failed to read costs at
   * all. Scoping inside the database also collapses "fetch the ids, then ask
   * again" into one round trip.
   */
  public async getCostDataForOwner(owner: AssumableRoleOwner, startDate: string, endDate: string): Promise<CostData[]> {
    const results = await this.database
      .prepare(
        `SELECT * FROM cost_data WHERE aws_account_id IN (SELECT DISTINCT aws_account_id FROM assumable_roles ar WHERE ${ownerClause('ar')}) AND period_start >= ? AND period_start <= ? ORDER BY aws_account_id, period_start ASC`,
      )
      .bind(owner.userId, owner.anchorEmail, startDate, endDate)
      .all<CostDataInternal>();

    return (results.results || []).map((row) => CostDataDAO.mapToExternal(row));
  }

  public async deleteOrphaned(): Promise<number> {
    const result: D1Result = await this.deleteOrphanedRows('cost_data', ORPHANED_BY_ASSUMABLE_ROLES);
    return result.meta?.changes ?? 0;
  }

  private static mapToExternal(row: CostDataInternal): CostData {
    return {
      awsAccountId: row.aws_account_id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      totalCost: row.total_cost,
      currency: row.currency,
      serviceBreakdown: row.service_breakdown ? JSON.parse(row.service_breakdown) : {},
      collectedAt: row.collected_at,
    };
  }
}

export { CostDataDAO };
