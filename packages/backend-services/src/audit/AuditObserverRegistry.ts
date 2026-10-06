import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import type { AuditEvent } from './AuditEventBuilder';
import type { IAuditObserver } from './AuditObserver';
import { AuditLogObserver } from './AuditObserver';

import { log } from '@aws-access-bridge/shared/utils';
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

  /**
   * Notify every observer, isolating failures from each other.
   *
   * `allSettled` rather than `all`, so one failing sink cannot prevent the
   * others from recording. The rejections are logged here rather than returned
   * for the caller to ignore: the audit trail is a governance control, so a
   * write that fails must leave a trace even though it cannot fail the request.
   */
public async notifyAll(event: AuditEvent): Promise<void> {
    const results = await Promise.allSettled(this.observers.map((observer) => observer.notify(event)));
    for (const result of results) {
      if (result.status === 'rejected') {
        log.error('Audit observer failed to record an event:', { error: result.reason instanceof Error ? result.reason.message : result.reason });
      }
    }
  }
}

export { AuditObserverRegistry };
