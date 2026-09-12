import type { CostData, CostDataInternal } from '@aws-access-bridge/shared/model';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';

class CostDataDAO {
  protected readonly database: D1Database | D1DatabaseSession;

  constructor(database: D1Database | D1DatabaseSession) {
    this.database = database;
  }

  public async upsertCostData(data: CostData): Promise<void> {
    await this.database
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
      .run();
  }

  public async getCostDataByAccount(awsAccountId: string, startDate: string, endDate: string): Promise<CostData[]> {
    const results = await this.database
      .prepare('SELECT * FROM cost_data WHERE aws_account_id = ? AND period_start >= ? AND period_start <= ? ORDER BY period_start ASC')
      .bind(awsAccountId, startDate, endDate)
      .all<CostDataInternal>();

    return (results.results || []).map((row) => CostDataDAO.mapToExternal(row));
  }

  public async getCostDataForAccounts(accountIds: string[], startDate: string, endDate: string): Promise<CostData[]> {
    if (accountIds.length === 0) return [];
    const placeholders: string = accountIds.map(() => '?').join(',');
    const results = await this.database
      .prepare(
        `SELECT * FROM cost_data WHERE aws_account_id IN (${placeholders}) AND period_start >= ? AND period_start <= ? ORDER BY aws_account_id, period_start ASC`,
      )
      .bind(...accountIds, startDate, endDate)
      .all<CostDataInternal>();

    return (results.results || []).map((row) => CostDataDAO.mapToExternal(row));
  }

  public async deleteOrphaned(): Promise<number> {
    const result: D1Result = await this.database
      .prepare('DELETE FROM cost_data WHERE aws_account_id NOT IN (SELECT DISTINCT aws_account_id FROM assumable_roles)')
      .run();
    return result.meta?.changes ?? 0;
  }

  public async getLatestCostSummary(accountIds: string[]): Promise<CostData[]> {
    if (accountIds.length === 0) return [];
    const placeholders: string = accountIds.map(() => '?').join(',');
    const results = await this.database
      .prepare(
        `SELECT cd.* FROM cost_data cd INNER JOIN (SELECT aws_account_id, MAX(period_start) as max_period FROM cost_data WHERE aws_account_id IN (${placeholders}) GROUP BY aws_account_id) latest ON cd.aws_account_id = latest.aws_account_id AND cd.period_start = latest.max_period`,
      )
      .bind(...accountIds)
      .all<CostDataInternal>();

    return (results.results || []).map((row) => CostDataDAO.mapToExternal(row));
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
