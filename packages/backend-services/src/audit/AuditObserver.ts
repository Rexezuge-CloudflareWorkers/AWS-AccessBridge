import { AuditLogDAO } from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import type { AuditEvent } from './AuditEventBuilder';

interface IAuditObserver {
  notify(event: AuditEvent): Promise<void>;
}

class AuditLogObserver implements IAuditObserver {
  constructor(private readonly database: D1Queryable) {}

  public async notify(event: AuditEvent): Promise<void> {
    const dao: AuditLogDAO = new AuditLogDAO(this.database);
    await dao.create({
      userEmail: event.userEmail,
      action: event.action,
      method: event.method,
      path: event.path,
      statusCode: event.statusCode,
      resource: event.resource,
      detail: event.detail,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      userId: event.userId ?? null,
    });
  }
}

export { AuditLogObserver };
export type { IAuditObserver };
