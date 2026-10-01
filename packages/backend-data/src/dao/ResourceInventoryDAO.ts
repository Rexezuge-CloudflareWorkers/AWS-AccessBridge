import type { ResourceInventoryItem, ResourceInventoryItemInternal } from '@aws-access-bridge/shared/model';
import { LIKEUtil } from '../utils/LIKEUtil';
import { BaseDAO } from './BaseDAO';
import { ORPHANED_BY_ASSUMABLE_ROLES } from './AwsAccountsDAO';

class ResourceInventoryDAO extends BaseDAO {
  public async upsertResource(item: ResourceInventoryItem): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT OR REPLACE INTO resource_inventory (aws_account_id, region, resource_type, resource_id, resource_name, state, metadata, collected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            item.awsAccountId,
            item.region,
            item.resourceType,
            item.resourceId,
            item.resourceName,
            item.state,
            JSON.stringify(item.metadata),
            item.collectedAt,
          )
          .run(),
      'upsert resource',
    );
  }

  public async deleteStaleResources(awsAccountId: string, resourceType: string, olderThan: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('DELETE FROM resource_inventory WHERE aws_account_id = ? AND resource_type = ? AND collected_at < ?')
          .bind(awsAccountId, resourceType, olderThan)
          .run(),
      'delete stale resources',
    );
  }

  public async deleteOrphaned(): Promise<number> {
    const result: D1Result = await this.deleteOrphanedRows('resource_inventory', ORPHANED_BY_ASSUMABLE_ROLES);
    return result.meta?.changes ?? 0;
  }

  public async searchResources(
    accountIds: string[],
    query?: string,
    resourceType?: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ items: ResourceInventoryItem[]; total: number }> {
    if (accountIds.length === 0) return { items: [], total: 0 };

    const placeholders: string = accountIds.map(() => '?').join(',');
    const conditions: string[] = [`aws_account_id IN (${placeholders})`];
    const bindings: unknown[] = [...accountIds];

    if (resourceType) {
      conditions.push('resource_type = ?');
      bindings.push(resourceType);
    }
    if (query) {
      // Escaped: an unescaped `%` in the search box would match every row.
      conditions.push(`(resource_name LIKE ? ${LIKEUtil.escapeClause} OR resource_id LIKE ? ${LIKEUtil.escapeClause})`);
      const pattern = LIKEUtil.contains(query);
      bindings.push(pattern, pattern);
    }

    const whereClause: string = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await this.database
      .prepare(`SELECT COUNT(*) as total FROM resource_inventory ${whereClause}`)
      .bind(...bindings)
      .first<{ total: number }>();

    const results = await this.database
      .prepare(`SELECT * FROM resource_inventory ${whereClause} ORDER BY resource_type, resource_name LIMIT ? OFFSET ?`)
      .bind(...bindings, limit, offset)
      .all<ResourceInventoryItemInternal>();

    return {
      items: (results.results || []).map((row) => ResourceInventoryDAO.mapToExternal(row)),
      total: countResult?.total || 0,
    };
  }

  public async getResourceCounts(accountIds: string[]): Promise<Record<string, Record<string, number>>> {
    if (accountIds.length === 0) return {};
    const placeholders: string = accountIds.map(() => '?').join(',');
    const results = await this.database
      .prepare(
        `SELECT aws_account_id, resource_type, COUNT(*) as count FROM resource_inventory WHERE aws_account_id IN (${placeholders}) GROUP BY aws_account_id, resource_type`,
      )
      .bind(...accountIds)
      .all<{ aws_account_id: string; resource_type: string; count: number }>();

    const counts: Record<string, Record<string, number>> = {};
    const rows = results.results || [];
    for (const row of rows) {
      if (counts[row.aws_account_id] === undefined) counts[row.aws_account_id] = {};
      counts[row.aws_account_id][row.resource_type] = row.count;
    }
    return counts;
  }

  private static mapToExternal(row: ResourceInventoryItemInternal): ResourceInventoryItem {
    return {
      awsAccountId: row.aws_account_id,
      region: row.region,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      resourceName: row.resource_name || '',
      state: row.state || '',
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      collectedAt: row.collected_at,
    };
  }
}

export { ResourceInventoryDAO };
