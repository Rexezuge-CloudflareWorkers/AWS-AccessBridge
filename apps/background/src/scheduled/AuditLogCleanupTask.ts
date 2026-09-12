import { AuditLogDAO } from '@aws-access-bridge/backend-data/dao/AuditLogDAO';
import { DEFAULT_AUDIT_LOG_RETENTION_DAYS } from '@aws-access-bridge/backend-runtime/config';
import { AbstractPruningTask } from './AbstractPruningTask';
import type { IEnv } from './IScheduledTask';

class AuditLogCleanupTask extends AbstractPruningTask<AuditLogCleanupTaskEnv> {
  protected override getTaskType(): string {
    return 'audit-log-cleanup';
  }

  protected getRetentionDays(env: AuditLogCleanupTaskEnv): number {
    return Number(env.AUDIT_LOG_RETENTION_DAYS || DEFAULT_AUDIT_LOG_RETENTION_DAYS);
  }

  protected async pruneBatch(db: D1Database, cutoffTimestamp: number, batchSize: number): Promise<number> {
    const auditLogDAO: AuditLogDAO = new AuditLogDAO(db);
    return auditLogDAO.deleteOlderThanBatch(cutoffTimestamp, batchSize);
  }
}

interface AuditLogCleanupTaskEnv extends IEnv {
  AUDIT_LOG_RETENTION_DAYS?: string;
  AccessBridgeDB: D1Database;
}

export { AuditLogCleanupTask };
