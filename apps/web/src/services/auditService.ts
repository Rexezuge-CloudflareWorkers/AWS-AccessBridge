import type { AuditLog } from '@aws-access-bridge/shared';
import { apiRequest } from '../lib/api';

/**
 * The shared model type, not a local copy: the service used to declare a subset
 * (no `ipAddress` / `userAgent`) and `AuditLogsTab` a second full one, so a field
 * added to the route's response had two places to be forgotten.
 */
type AuditLogEntry = AuditLog;

interface AuditLogsResult {
  logs: AuditLogEntry[];
  total: number;
}

interface AuditLogsOptions {
  userEmail?: string;
  action?: string;
  limit?: number;
  offset?: number;
}

async function queryAuditLogs(options: AuditLogsOptions = {}): Promise<AuditLogsResult> {
  const params = new URLSearchParams();
  if (options.userEmail) params.set('userEmail', options.userEmail);
  if (options.action) params.set('action', options.action);
  params.set('limit', String(options.limit ?? 50));
  params.set('offset', String(options.offset ?? 0));
  return apiRequest<AuditLogsResult>(`/user/admin/audit-logs?${params.toString()}`, { method: 'GET' });
}

export type { AuditLogEntry, AuditLogsOptions, AuditLogsResult };
export { queryAuditLogs };
