import { DatabaseError } from '@aws-access-bridge/backend-errors';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import { toSafeBatchSize } from './BatchSize';
import { BaseDAO } from './BaseDAO';

class CredentialCacheConfigDAO extends BaseDAO {
  /**
   * Idempotently register a principal for scheduled cache refresh.
   *
   * `INSERT OR IGNORE` because this runs on every credential store, including
   * re-stores of a principal that is already tracked; a plain INSERT would throw
   * on the primary key.
   */
  public async create(principalArn: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare('INSERT OR IGNORE INTO credential_cache_config (principal_arn) VALUES (?)')
      .bind(principalArn)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to create cache config: ${result.error}`);
    }
  }

  public async delete(principalArn: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare('DELETE FROM credential_cache_config WHERE principal_arn = ?')
      .bind(principalArn)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to delete cache config: ${result.error}`);
    }
  }

  public async updateLastCachedTime(
    principalArn: string,
    timestamp: number = TimestampUtil.getCurrentUnixTimestampInSeconds(),
  ): Promise<void> {
    const result: D1Result = await this.database
      .prepare('UPDATE credential_cache_config SET last_cached_at = ? WHERE principal_arn = ?')
      .bind(timestamp, principalArn)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to update cache config: ${result.error}`);
    }
  }

  /**
   * @param limit A *batch* size, not a page size: the caller walks one batch per
   *   cron tick, so clamping it to `Pagination.MAX_LIMIT` would silently change
   *   how much work a tick does. Clamped to a positive integer only, because an
   *   unbounded or non-numeric `LIMIT ?` is rejected by the database.
   */
  public async getPrincipalArnsNeedingUpdate(limit: number, olderThanTimestamp: number): Promise<string[]> {
    const batchSize: number = toSafeBatchSize(limit);
    const results: D1Result<GetPrincipalsNeedingUpdateInternal> = await this.database
      .prepare('SELECT principal_arn FROM credential_cache_config WHERE last_cached_at < ? ORDER BY last_cached_at ASC LIMIT ?')
      .bind(olderThanTimestamp, batchSize)
      .all<GetPrincipalsNeedingUpdateInternal>();
    return results.results.map((r) => r.principal_arn);
  }
}

interface GetPrincipalsNeedingUpdateInternal {
  principal_arn: string;
}

export { CredentialCacheConfigDAO };
