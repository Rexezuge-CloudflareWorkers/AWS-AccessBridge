import { DatabaseError } from '@aws-access-bridge/backend-errors';
import type { AuditLog, AuditLogInternal } from '@aws-access-bridge/shared/model';
import { TimestampUtil, UUIDUtil } from '@aws-access-bridge/shared/utils';
import { BaseDAO } from './BaseDAO';

class AuditLogDAO extends BaseDAO {
  public async create(
    userEmail: string,
    action: string,
    method: string,
    path: string,
    statusCode: number,
    resource?: string,
    detail?: string,
    ipAddress?: string,
    userAgent?: string,
    userId: string | null = null,
  ): Promise<void> {
    const logId: string = UUIDUtil.getRandomUUID();
    const timestamp: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const result: D1Result = await this.database
      .prepare(
        'INSERT INTO audit_logs (log_id, timestamp, user_email, user_id, action, resource, method, path, status_code, detail, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        logId,
        timestamp,
        userEmail,
        userId,
        action,
        resource || null,
        method,
        path,
        statusCode,
        detail || null,
        ipAddress || null,
        userAgent || null,
      )
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to create audit log: ${result.error}`);
    }
  }

  public async query(filters: AuditLogQueryFilters, limit: number = 50, offset: number = 0): Promise<{ logs: AuditLog[]; total: number }> {
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (filters.userId) {
      // `id OR (id IS NULL AND address)`: the id arm returns every entry for the
      // account whichever address was current at write time, and the NULL arm
      // keeps pre-0032 rows the filter would otherwise hide. The `IS NULL` guard
      // stops the address arm from re-matching a row the id arm already took.
      conditions.push('(user_id = ? OR (user_id IS NULL AND user_email = ?))');
      bindings.push(filters.userId, filters.userEmail ?? '');
    } else if (filters.userEmail) {
      conditions.push('user_email = ?');
      bindings.push(filters.userEmail);
    }
    if (filters.action) {
      conditions.push('action = ?');
      bindings.push(filters.action);
    }
    // `!== undefined` rather than truthiness: the query schema accepts 0, and
    // `endTime=0` ("nothing before the epoch") would otherwise be dropped,
    // silently widening the query to the entire audit log.
    if (filters.startTime !== undefined) {
      conditions.push('timestamp >= ?');
      bindings.push(filters.startTime);
    }
    if (filters.endTime !== undefined) {
      conditions.push('timestamp <= ?');
      bindings.push(filters.endTime);
    }

    const whereClause: string = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.database
      .prepare(`SELECT COUNT(*) as total FROM audit_logs ${whereClause}`)
      .bind(...bindings)
      .first<{ total: number }>();

    const total: number = countResult?.total || 0;

    const results = await this.database
      .prepare(
        `SELECT log_id, timestamp, user_email, action, resource, method, path, status_code, detail, ip_address, user_agent FROM audit_logs ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, limit, offset)
      .all<AuditLogInternal>();

    const logs: AuditLog[] = (results.results || []).map((row) => ({
      logId: row.log_id,
      timestamp: row.timestamp,
      userEmail: row.user_email,
      action: row.action,
      resource: row.resource,
      method: row.method,
      path: row.path,
      statusCode: row.status_code,
      detail: row.detail,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
    }));

    return { logs, total };
  }

  public async deleteOlderThanBatch(cutoffTimestamp: number, batchSize: number): Promise<number> {
    // Checked: `AbstractPruningTask` reads the returned count to decide whether
    // to loop, so a `{success: false}` result resolving as 0 rows made retention
    // log "pruned 0" and exit as a success while the table grew unbounded.
    const result: D1Result = await this.withRetry(
      () =>
        this.database
          .prepare('DELETE FROM audit_logs WHERE timestamp < ? LIMIT ?')
          .bind(cutoffTimestamp, batchSize)
          .run(),
      'delete old audit logs',
    );
    return result.meta?.changes ?? 0;
  }
}

interface AuditLogQueryFilters {
  userEmail?: string;
  /**
   * Account id. Preferred over `userEmail`, which survives an address change
   * only because the id arm matches every row for the account. Supplying both
   * is the intended usage: the address narrows the unattributed rows.
   */
  userId?: string;
  action?: string;
  startTime?: number;
  endTime?: number;
}

export { AuditLogDAO };
export type { AuditLogQueryFilters };
