import { apiRequest } from '../lib/api';

interface AuditLogEntry {
  logId: string;
  userEmail: string;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  resource?: string;
  detail?: string;
  timestamp: number;
}

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
