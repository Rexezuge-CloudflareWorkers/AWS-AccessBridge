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
    await dao.create(
      event.userEmail,
      event.action,
      event.method,
      event.path,
      event.statusCode,
      event.resource,
      event.detail,
      event.ipAddress,
      event.userAgent,
    );
  }
}

export { AuditLogObserver };
export type { IAuditObserver };
