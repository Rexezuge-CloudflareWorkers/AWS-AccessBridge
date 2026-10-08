import { RequestOriginUtil } from '@aws-access-bridge/shared/utils';
import { AUDIT_MAX_PATH_LENGTH } from '@aws-access-bridge/shared/constants';
import { AUDIT_ACTIONS } from './AuditActions';
import { AuditEventBuilder, type AuditEvent } from './AuditEventBuilder';

/**
 * Payload-builder split from `AuditEventBuilder` (Otter
 * `NotificationPayloadBuilder` precedent). Owns request → event mapping
 * (action resolution, IP/UA extraction) so `AuditService` stays a thin
 * fan-out and the mapping is unit-testable without D1.
 */
class AuditPayloadBuilder {
  public static resolveAction(method: string, path: string): string {
    return AUDIT_ACTIONS[`${method}:${path}`] || `${method}:${path}`;
  }

  public static fromRequest(
    request: Request,
    userEmail: string,
    statusCode: number,
    envForOrigin?: unknown,
    userId: string | null = null,
  ): AuditEvent {
    const method: string = request.method;
    // Capped up front: the action is derived from the path, so an unbounded
    // path would also make the action column attacker-bloatable.
    const path: string = new URL(request.url).pathname.slice(0, AUDIT_MAX_PATH_LENGTH);
    return AuditEventBuilder.create()
      .userEmail(userEmail)
      .userId(userId)
      .action(this.resolveAction(method, path))
      .request(method, path)
      .status(statusCode)
      .network(RequestOriginUtil.getClientIpAddress(request, envForOrigin), request.headers.get('User-Agent') ?? undefined)
      .build();
  }
}

export { AuditPayloadBuilder };
