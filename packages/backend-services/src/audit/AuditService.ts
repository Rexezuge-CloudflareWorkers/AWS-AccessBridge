import { AuditLogDAO, type AuditLogQueryFilters } from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import type { AuditLog } from '@aws-access-bridge/shared/model';
import { RequestOriginUtil } from '@aws-access-bridge/shared/utils';
import { AUDIT_ACTIONS } from './AuditActions';
import { AuditEventBuilder, type AuditEvent } from './AuditEventBuilder';
import { AuditLogObserver, type IAuditObserver } from './AuditObserver';

interface AuditServiceEnv {
  AccessBridgeDB: D1Queryable;
}

class AuditService {
  private readonly observers: IAuditObserver[];

  constructor(
    private readonly env: AuditServiceEnv,
    observers?: IAuditObserver[],
  ) {
    this.observers = observers ?? [new AuditLogObserver(env.AccessBridgeDB)];
  }

  public static resolveAction(method: string, path: string): string {
    return AUDIT_ACTIONS[`${method}:${path}`] || `${method}:${path}`;
  }

  public buildRequestEvent(request: Request, userEmail: string, statusCode: number, envForOrigin?: unknown): AuditEvent {
    const method: string = request.method;
    const path: string = new URL(request.url).pathname;
    return AuditEventBuilder.create()
      .userEmail(userEmail)
      .action(AuditService.resolveAction(method, path))
      .request(method, path)
      .status(statusCode)
      .network(RequestOriginUtil.getClientIpAddress(request, envForOrigin), request.headers.get('User-Agent') ?? undefined)
      .build();
  }

  public async record(event: AuditEvent): Promise<void> {
    await Promise.allSettled(this.observers.map((observer) => observer.notify(event)));
  }

  public async queryLogs(
    filters: AuditLogQueryFilters,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ logs: AuditLog[]; total: number }> {
    const dao: AuditLogDAO = new AuditLogDAO(this.env.AccessBridgeDB);
    return dao.query(filters, limit, offset);
  }
}

class AuditServiceFactory {
  public static create(env: AuditServiceEnv, observers?: IAuditObserver[]): AuditService {
    return new AuditService(env, observers);
  }
}

export { AuditService, AuditServiceFactory };
export type { AuditServiceEnv };
