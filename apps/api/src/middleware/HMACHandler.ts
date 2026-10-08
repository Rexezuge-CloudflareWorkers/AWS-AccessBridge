import { Context, Next } from 'hono';
import {
  HMAC_HANDLER_ERROR_MISSING_AUTHENTICATION_HEADERS,
  HMAC_HANDLER_ERROR_REQUEST_OUTSIDE_TIME_WINDOW,
  HMAC_HANDLER_ERROR_REQUEST_REPLAYED,
  HMAC_HANDLER_ERROR_SIGNATURE_INVALID,
} from '@aws-access-bridge/shared/constants';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { INTERNAL_HEADER_PREFIX, INTERNAL_SIGNATURE_HEADER, INTERNAL_TIMESTAMP_HEADER } from '@aws-access-bridge/shared/constants';
import { verifyHMACSignature, hashBody } from '@aws-access-bridge/backend-data/crypto/hmac';
import { ReplayGuard } from '@aws-access-bridge/backend-services/auth/ReplayGuard';
import { UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import type { Clock } from '@aws-access-bridge/shared/utils';

class HMACHandler {
  /**
   * @param clock Injected so a test can place a signed request inside or outside
   *   the replay window deterministically. Asserting the window edge otherwise
   *   means either freezing time globally or sleeping, and a test that sleeps is a
   *   test that flakes.
   * @param replayGuard Claims the signature so it cannot be presented twice.
   *   Injected for the same reason, plus so a test can assert the replay path
   *   without standing up KV.
   */
  public static async validateInternalRequest(
    c: Context<{ Bindings: Env }>,
    next: Next,
    clock?: Clock,
    replayGuard?: ReplayGuard,
  ): Promise<void> {
    const signature: string | undefined = c.req.header(INTERNAL_SIGNATURE_HEADER);
    const timestamp: string | undefined = c.req.header(INTERNAL_TIMESTAMP_HEADER);
    if (!signature || !timestamp) {
      throw new UnauthorizedError(HMAC_HANDLER_ERROR_MISSING_AUTHENTICATION_HEADERS);
    }

    // Strict shape first: `parseInt` would accept '1678886400000junk' or '1678...e12'
    // fragments and compare them as numbers, and a lax parse is how a replay bypasses
    // the window check. `Number.isFinite` guards the arithmetic after the shape check.
    if (!/^\d{13}$/.test(timestamp)) {
      throw new UnauthorizedError(HMAC_HANDLER_ERROR_REQUEST_OUTSIDE_TIME_WINDOW);
    }
    const now: number = TimestampUtil.getCurrentUnixTimestampInMilliseconds(clock);
    const requestTime: number = Number(timestamp);
    if (!Number.isFinite(requestTime) || Math.abs(now - requestTime) > ConfigurationManager.internal.getRequestTimeWindowMs(c.env)) {
      throw new UnauthorizedError(HMAC_HANDLER_ERROR_REQUEST_OUTSIDE_TIME_WINDOW);
    }

    // Body clone/hash and the secret fetch happen only after the timestamp is
    // known-good: a badly shaped or stale request is rejected before any work
    // that a forgery should not be able to make the worker do.
    const bodyHash: string = await hashBody(await c.req.raw.clone().text());
    // Sign the query string too. Without it a captured, validly signed request
    // stays valid after query parameters are appended, making the signature
    // malleable — harmless for the current body-only internal calls, but an
    // auth-bypass primitive as soon as one signs a GET.
    const requestUrl: URL = new URL(c.req.url);
    const path: string = requestUrl.pathname + requestUrl.search;
    const headers: Record<string, string> = {};
    for (const [key, value] of c.req.raw.headers.entries()) {
      if (key !== INTERNAL_SIGNATURE_HEADER && key.startsWith(INTERNAL_HEADER_PREFIX)) {
        headers[key] = value;
      }
    }

    const secret: string = await c.env.INTERNAL_REQUEST_HMAC_SECRET.get();
    const isValid: boolean = await verifyHMACSignature(secret, signature, headers, timestamp, bodyHash, path, c.req.method);
    if (!isValid) {
      // Claimed only after the signature verifies. Claiming first would let an
      // unauthenticated caller burn a legitimate signature by replaying it once
      // and making the real request fail.
      throw new UnauthorizedError(HMAC_HANDLER_ERROR_SIGNATURE_INVALID);
    }

    // After verification, so a forged signature cannot poison the seen-set, and
    // before `next()`, so a replay is refused before it acts as the caller.
    if (replayGuard && !(await replayGuard.claim(signature))) {
      throw new UnauthorizedError(HMAC_HANDLER_ERROR_REQUEST_REPLAYED);
    }

    await next();
  }
}

export { HMACHandler };
