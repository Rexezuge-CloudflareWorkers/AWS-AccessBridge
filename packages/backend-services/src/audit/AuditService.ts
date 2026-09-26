import { AuditLogDAO, type AuditLogQueryFilters } from '@aws-access-bridge/backend-data/dao';

import type { AuditLog } from '@aws-access-bridge/shared/model';
import { type AuditEvent } from './AuditEventBuilder';
import { type IAuditObserver } from './AuditObserver';
import { AuditObserverRegistry } from './AuditObserverRegistry';
import { AuditPayloadBuilder } from './AuditPayloadBuilder';
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

  public buildRequestEvent(request: Request, userEmail: string, statusCode: number, envForOrigin?: unknown): AuditEvent {
    return AuditPayloadBuilder.fromRequest(request, userEmail, statusCode, envForOrigin);
  }

  public async record(event: AuditEvent): Promise<void> {
    await this.registry.notifyAll(event);
  }

  public async queryLogs(
    filters: AuditLogQueryFilters,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ logs: AuditLog[]; total: number }> {
    const dao: AuditLogDAO = new AuditLogDAO(this.env.AccessBridgeDB);
    return dao.query(filters, limit, offset);
  }
}export { AuditService };
export type { AuditServiceEnv };
