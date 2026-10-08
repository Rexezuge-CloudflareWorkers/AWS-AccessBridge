import { describe, expect, it, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrations';
import { AuditLogDAO } from '@aws-access-bridge/backend-data/dao/AuditLogDAO';
import { BackgroundTaskRunDAO } from '@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO';

/**
 * Retention pruning against real D1, including the batch boundary.
 *
 * `DELETE ... LIMIT ?` is not supported on D1's SQLite build, so the DAOs
 * express the batch boundary as a rowid subquery. These tests pin that the
 * rewrite behaves the same as the intent: rows strictly older than the
 * cutoff are removed — the row AT the boundary must survive.
 */
describe('Retention pruning against real D1', () => {
  beforeAll(async () => {
    await applyMigrations(env.AccessBridgeDB);
  });

  async function insertAuditLog(logId: string, timestamp: number): Promise<void> {
    await env.AccessBridgeDB.prepare(
      `INSERT INTO audit_logs (log_id, timestamp, user_email, action, method, path, status_code) VALUES (?, ?, 'u', 'A', 'GET', '/x', 200)`,
    )
      .bind(logId, timestamp)
      .run();
  }

  it('prunes expired audit logs but keeps the retention-boundary row', async () => {
    const dao = new AuditLogDAO(env.AccessBridgeDB as never);
    const now = 1_800_000_000;
    await insertAuditLog('old-1', now - 30);
    await insertAuditLog('old-2', now - 20);
    await insertAuditLog('old-3', now - 10);
    await insertAuditLog('boundary', now);
    await insertAuditLog('fresh', now + 10);

    const deleted: number = await dao.deleteOlderThanBatch(now, 50);
    expect(deleted).toBe(3);
    const remaining = await env.AccessBridgeDB.prepare('SELECT log_id FROM audit_logs ORDER BY log_id').all<{ log_id: string }>();
    expect(remaining.results.map((row) => row.log_id)).toEqual(['boundary', 'fresh']);
  });

  it('prunes expired task runs but keeps the retention-boundary row', async () => {
    const dao = new BackgroundTaskRunDAO(env.AccessBridgeDB as never);
    const now = 1_800_000_000;
    for (let i = 0; i < 3; i++) {
      await env.AccessBridgeDB.prepare(
        `INSERT INTO background_task_runs (run_id, task_type, status, items_processed, items_failed, started_at, created_at) VALUES (?, 't', 'success', 0, 0, ?, ?)`,
      )
        .bind(`old-${i}`, now - 10, now - 10)
        .run();
    }
    await env.AccessBridgeDB.prepare(
      `INSERT INTO background_task_runs (run_id, task_type, status, items_processed, items_failed, started_at, created_at) VALUES ('boundary', 't', 'success', 0, 0, ?, ?)`,
    )
      .bind(now, now)
      .run();

    const deleted: number = await dao.deleteOlderThanBatch(now, 50);
    expect(deleted).toBe(3);
    const remaining = await env.AccessBridgeDB.prepare('SELECT run_id FROM background_task_runs').all<{ run_id: string }>();
    expect(remaining.results.map((row) => row.run_id)).toEqual(['boundary']);
  });

  it('honours the batch size over the prunable rows', async () => {
    const dao = new AuditLogDAO(env.AccessBridgeDB as never);
    const now = 1_800_000_000;
    for (let i = 0; i < 5; i++) {
      await insertAuditLog(`batch-old-${i}`, now - 10);
    }
    const deleted: number = await dao.deleteOlderThanBatch(now, 2);
    expect(deleted).toBe(2);
    const remaining = await env.AccessBridgeDB.prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE log_id LIKE 'batch-old-%'`).first<{
      c: number;
    }>();
    expect(remaining?.c).toBe(3);
  });
});
