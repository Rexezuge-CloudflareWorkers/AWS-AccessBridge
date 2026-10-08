import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import { toSafeBatchSize } from './BatchSize';
import { BaseDAO } from './BaseDAO';

class DataCollectionConfigDAO extends BaseDAO {
  public async create(principalArn: string, collectionType: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT OR IGNORE INTO data_collection_config (principal_arn, collection_type, last_collected_at, enabled) VALUES (?, ?, 0, 1)',
          )
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
    const result: D1Result = await this.deleteOrphanedRows(
      'data_collection_config',
      'principal_arn NOT IN (SELECT principal_arn FROM credentials)',
    );
    return result.meta?.changes ?? 0;
  }

  /**
   * @param limit A *batch* size, not a page size — see the note on
   *   `CredentialCacheConfigDAO.getPrincipalArnsNeedingUpdate`. Only guarded
   *   against a non-positive or non-integer value, which `LIMIT ?` rejects.
   */
  /**
   * Principals due for collection, oldest attempt first.
   *
   * Filters and orders on `last_attempt_at` — the attempt clock, not the
   * success clock — so a principal that fails or returns empty is retried on
   * the collection interval rather than on the next tick. Stamping
   * `last_collected_at` on failure would have misstated when the last
   * successful collection was; not stamping anything would starve the rest
   * of the batch, since this query is always oldest-first with a batch
   * limit.
   *
   * @param limit A *batch* size, not a page size — see the note on
   *   `CredentialCacheConfigDAO.getPrincipalArnsNeedingUpdate`. Only guarded
   *   against a non-positive or non-integer value, which `LIMIT ?` rejects.
   */
  public async getPrincipalArnsNeedingCollection(collectionType: string, limit: number, olderThan: number): Promise<string[]> {
    const batchSize: number = toSafeBatchSize(limit);
    const results = await this.database
      .prepare(
        'SELECT principal_arn FROM data_collection_config WHERE collection_type = ? AND enabled = 1 AND last_attempt_at < ? ORDER BY last_attempt_at ASC LIMIT ?',
      )
      .bind(collectionType, olderThan, batchSize)
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

  /**
   * Stamp every attempt — success, empty result, failure — so the due-query
   * can reorder on it. `last_collected_at` is advanced only on a successful
   * collection with data.
   */
  public async updateLastAttemptTime(principalArn: string, collectionType: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE data_collection_config SET last_attempt_at = ? WHERE principal_arn = ? AND collection_type = ?')
          .bind(TimestampUtil.getCurrentUnixTimestampInSeconds(), principalArn, collectionType)
          .run(),
      'update last attempt time',
    );
  }
}

export { DataCollectionConfigDAO };
