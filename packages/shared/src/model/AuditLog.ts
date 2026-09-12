interface AuditLog {
  logId: string;
  timestamp: number;
  userEmail: string;
  action: string;
  resource?: string;
  method: string;
  path: string;
  statusCode: number;
  detail?: string;
  ipAddress?: string;
  userAgent?: string;
}

interface AuditLogInternal {
  log_id: string;
  timestamp: number;
  user_email: string;
  action: string;
  resource?: string;
  method: string;
  path: string;
  status_code: number;
  detail?: string;
  ip_address?: string;
  user_agent?: string;
}

export type { AuditLog, AuditLogInternal };
