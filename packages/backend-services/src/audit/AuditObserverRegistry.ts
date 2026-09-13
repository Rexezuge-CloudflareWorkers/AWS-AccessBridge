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

  public static withDefaults(database: { execute(...args: never[]): unknown }): AuditObserverRegistry {
    return new AuditObserverRegistry([new AuditLogObserver(database as never)]);
  }

  public static withObservers(observers: IAuditObserver[]): AuditObserverRegistry {
    return new AuditObserverRegistry(observers);
  }

  public getAll(): readonly IAuditObserver[] {
    return this.observers;
  }

  public async notifyAll(event: Parameters<IAuditObserver['notify']>[0]): Promise<PromiseSettledResult<void>[]> {
    return Promise.allSettled(this.observers.map((observer) => observer.notify(event)));
  }
}

export { AuditObserverRegistry };
