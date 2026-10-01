import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import { BaseDAO } from './BaseDAO';

class DataCollectionConfigDAO extends BaseDAO {
  public async create(principalArn: string, collectionType: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('INSERT OR IGNORE INTO data_collection_config (principal_arn, collection_type, last_collected_at, enabled) VALUES (?, ?, 0, 1)')
          .bind(principalArn, collectionType)
          .run(),
      'create collection config',
    );
  }

  public async delete(principalArn: string, collectionType: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('DELETE FROM data_collection_config WHERE principal_arn = ? AND collection_type = ?')
          .bind(principalArn, collectionType)
          .run(),
      'delete collection config',
    );
  }

  public async deleteOrphaned(): Promise<number> {
    // Keyed on the principal rather than an account: a collection config whose
    // credentials row is gone can never be resolved again, so it is an orphan.
    const result: D1Result = await this.deleteOrphanedRows('data_collection_config', 'principal_arn NOT IN (SELECT principal_arn FROM credentials)');
    return result.meta?.changes ?? 0;
  }

  public async getPrincipalArnsNeedingCollection(collectionType: string, limit: number, olderThan: number): Promise<string[]> {
    const results = await this.database
      .prepare(
        'SELECT principal_arn FROM data_collection_config WHERE collection_type = ? AND enabled = 1 AND last_collected_at < ? ORDER BY last_collected_at ASC LIMIT ?',
      )
      .bind(collectionType, olderThan, limit)
      .all<{ principal_arn: string }>();

    return (results.results || []).map((row) => row.principal_arn);
  }

  public async updateLastCollectedTime(principalArn: string, collectionType: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE data_collection_config SET last_collected_at = ? WHERE principal_arn = ? AND collection_type = ?')
          .bind(TimestampUtil.getCurrentUnixTimestampInSeconds(), principalArn, collectionType)
          .run(),
      'update last collected time',
    );
  }
}

export { DataCollectionConfigDAO };