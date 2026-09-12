import { DatabaseError } from '@aws-access-bridge/backend-errors';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import { BaseDAO } from './BaseDAO';

class CredentialCacheConfigDAO extends BaseDAO {
  public async create(principalArn: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare('INSERT INTO credential_cache_config (principal_arn) VALUES (?)')
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

  public async getPrincipalArnsNeedingUpdate(limit: number, olderThanTimestamp: number): Promise<string[]> {
    const results: D1Result<GetPrincipalsNeedingUpdateInternal> = await this.database
      .prepare('SELECT principal_arn FROM credential_cache_config WHERE last_cached_at < ? ORDER BY last_cached_at ASC LIMIT ?')
      .bind(olderThanTimestamp, limit)
      .all<GetPrincipalsNeedingUpdateInternal>();
    return results.results.map((r) => r.principal_arn);
  }
}

interface GetPrincipalsNeedingUpdateInternal {
  principal_arn: string;
}

export { CredentialCacheConfigDAO };
