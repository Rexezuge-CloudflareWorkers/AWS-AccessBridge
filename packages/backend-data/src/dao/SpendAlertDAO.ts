import type { SpendAlert, SpendAlertInternal } from '@aws-access-bridge/shared/model';
import { TimestampUtil, UUIDUtil } from '@aws-access-bridge/shared/utils';
import { BaseDAO } from './BaseDAO';
import { ORPHANED_BY_ASSUMABLE_ROLES } from './AwsAccountsDAO';

class SpendAlertDAO extends BaseDAO {
  public async createAlert(awsAccountId: string, thresholdAmount: number, periodType: string, createdBy: string): Promise<SpendAlert> {
    const alertId: string = UUIDUtil.getRandomUUID();
    const createdAt: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO spend_alerts (alert_id, aws_account_id, threshold_amount, currency, period_type, created_by, created_at, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
          )
          .bind(alertId, awsAccountId, thresholdAmount, 'USD', periodType, createdBy, createdAt)
          .run(),
      'create spend alert',
    );

    return { alertId, awsAccountId, thresholdAmount, currency: 'USD', periodType, createdBy, createdAt, enabled: true };
  }

  public async deleteAlert(alertId: string): Promise<void> {
    await this.withRetry(() => this.database.prepare('DELETE FROM spend_alerts WHERE alert_id = ?').bind(alertId).run(), 'delete spend alert');
  }

  public async deleteOrphaned(): Promise<number> {
    const result: D1Result = await this.deleteOrphanedRows('spend_alerts', ORPHANED_BY_ASSUMABLE_ROLES);
    return result.meta?.changes ?? 0;
  }

  public async getAlertsByAccount(awsAccountId: string): Promise<SpendAlert[]> {
    const results = await this.database
      .prepare('SELECT * FROM spend_alerts WHERE aws_account_id = ? AND enabled = 1')
      .bind(awsAccountId)
      .all<SpendAlertInternal>();

    return (results.results || []).map((row) => SpendAlertDAO.mapToExternal(row));
  }

  public async getAllAlerts(): Promise<SpendAlert[]> {
    const results = await this.database
      .prepare('SELECT * FROM spend_alerts WHERE enabled = 1 ORDER BY created_at DESC')
      .all<SpendAlertInternal>();
    return (results.results || []).map((row) => SpendAlertDAO.mapToExternal(row));
  }

  private static mapToExternal(row: SpendAlertInternal): SpendAlert {
    return {
      alertId: row.alert_id,
      awsAccountId: row.aws_account_id,
      thresholdAmount: row.threshold_amount,
      currency: row.currency,
      periodType: row.period_type,
      createdBy: row.created_by,
      createdAt: row.created_at,
      enabled: row.enabled === 1,
    };
  }
}

export { SpendAlertDAO };
