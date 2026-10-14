import type { SpendAlert } from '@aws-access-bridge/shared/model';
import { TimestampUtil, UUIDUtil } from '@rexezuge/shared';
import { BaseDAO } from './BaseDAO';
import { ORPHANED_BY_ASSUMABLE_ROLES } from './AwsAccountsDAO';

class SpendAlertDAO extends BaseDAO {
  public async createAlert(awsAccountId: string, thresholdAmount: number, periodType: string, createdBy: string): Promise<SpendAlert> {
    const alertId: string = UUIDUtil.getRandomUUID();
    const createdAt: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await this.run(
      'INSERT INTO spend_alerts (alert_id, aws_account_id, threshold_amount, currency, period_type, created_by, created_at, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      [alertId, awsAccountId, thresholdAmount, 'USD', periodType, createdBy, createdAt],
    );

    return { alertId, awsAccountId, thresholdAmount, currency: 'USD', periodType, createdBy, createdAt, enabled: true };
  }

  public async deleteAlert(alertId: string): Promise<void> {
    await this.run('DELETE FROM spend_alerts WHERE alert_id = ?', [alertId]);
  }

  public async deleteOrphaned(): Promise<number> {
    const result = await this.deleteOrphanedRows('spend_alerts', ORPHANED_BY_ASSUMABLE_ROLES);
    return result.meta?.changes ?? 0;
  }
}

export { SpendAlertDAO };
