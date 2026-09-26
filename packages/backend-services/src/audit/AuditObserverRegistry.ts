import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import type { AuditEvent } from './AuditEventBuilder';
import type { IAuditObserver } from './AuditObserver';
import { AuditLogObserver } from './AuditObserver';

/**
 * Injectable observer registry (Otter `IntegrationObserverRegistry`
 * precedent). `AuditService` keeps its `Promise.allSettled` fan-out but
 * resolves observers through here so a 2nd sink (webhook/SIEM) plugs in
 * without touching call sites. Hermetic tests use `withObservers(...)`.
 */
class AuditObserverRegistry {
  private readonly observers: IAuditObserver[];

  constructor(observers: IAuditObserver[] = []) {
    this.observers = [...observers];
  }

  public static withDefaults(database: D1Queryable): AuditObserverRegistry {
    return new AuditObserverRegistry([new AuditLogObserver(database)]);
  }

  public static withObservers(observers: IAuditObserver[]): AuditObserverRegistry {
    return new AuditObserverRegistry(observers);
  }

  public getAll(): readonly IAuditObserver[] {
    return this.observers;
  }

  public async notifyAll(event: AuditEvent): Promise<PromiseSettledResult<void>[]> {
    return Promise.allSettled(this.observers.map((observer) => observer.notify(event)));
  }
}

export { AuditObserverRegistry };
