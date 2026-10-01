import { AuditLogDAO, type AuditLogQueryFilters } from '@aws-access-bridge/backend-data/dao';

import type { AuditLog } from '@aws-access-bridge/shared/model';
import { type AuditEvent } from './AuditEventBuilder';
import { type IAuditObserver } from './AuditObserver';
import { AuditObserverRegistry } from './AuditObserverRegistry';
import { AuditPayloadBuilder } from './AuditPayloadBuilder';
import { Pagination } from '@aws-access-bridge/backend-runtime/constants';
import type { ServiceEnv } from '../composition/ServiceEnv';

type AuditServiceEnv = ServiceEnv;

class AuditService {
  private readonly registry: AuditObserverRegistry;

  constructor(
    private readonly env: AuditServiceEnv,
    observers?: IAuditObserver[],
  ) {
    this.registry =
      observers === undefined
        ? AuditObserverRegistry.withDefaults(env.AccessBridgeDB)
        : AuditObserverRegistry.withObservers(observers);
  }

  public static resolveAction(method: string, path: string): string {
    return AuditPayloadBuilder.resolveAction(method, path);
  }

  public buildRequestEvent(
    request: Request,
    userEmail: string,
    statusCode: number,
    envForOrigin?: unknown,
    userId: string | null = null,
  ): AuditEvent {
    return AuditPayloadBuilder.fromRequest(request, userEmail, statusCode, envForOrigin, userId);
  }

  /**
   * Record an event to every observer.
   *
   * Never rejects: a failing audit sink must not fail the request that triggered
   * it, and `activityAudit` runs this detached via `waitUntil`. Failures are
   * logged inside `AuditObserverRegistry.notifyAll`.
   */
public async record(event: AuditEvent): Promise<void> {
    await this.registry.notifyAll(event);
  }

  public async queryLogs(
    filters: AuditLogQueryFilters,
    limit?: number,
    offset?: number,
  ): Promise<{ logs: AuditLog[]; total: number }> {
    const dao: AuditLogDAO = new AuditLogDAO(this.env.AccessBridgeDB);
    return dao.query(filters, Pagination.limit(limit), Pagination.offset(offset));
  }
}export { AuditService };
export type { AuditServiceEnv };
