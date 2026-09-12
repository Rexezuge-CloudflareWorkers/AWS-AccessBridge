import { TimestampUtil } from '@aws-access-bridge/shared/utils';

class DataCollectionConfigDAO {
  protected readonly database: D1Database | D1DatabaseSession;

  constructor(database: D1Database | D1DatabaseSession) {
    this.database = database;
  }

  public async create(principalArn: string, collectionType: string): Promise<void> {
    await this.database
      .prepare(
        'INSERT OR IGNORE INTO data_collection_config (principal_arn, collection_type, last_collected_at, enabled) VALUES (?, ?, 0, 1)',
      )
      .bind(principalArn, collectionType)
      .run();
  }

  public async delete(principalArn: string, collectionType: string): Promise<void> {
    await this.database
      .prepare('DELETE FROM data_collection_config WHERE principal_arn = ? AND collection_type = ?')
      .bind(principalArn, collectionType)
      .run();
  }

  public async deleteOrphaned(): Promise<number> {
    const result: D1Result = await this.database
      .prepare('DELETE FROM data_collection_config WHERE principal_arn NOT IN (SELECT principal_arn FROM credentials)')
      .run();
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
    await this.database
      .prepare('UPDATE data_collection_config SET last_collected_at = ? WHERE principal_arn = ? AND collection_type = ?')
      .bind(TimestampUtil.getCurrentUnixTimestampInSeconds(), principalArn, collectionType)
      .run();
  }
}

export { DataCollectionConfigDAO };
