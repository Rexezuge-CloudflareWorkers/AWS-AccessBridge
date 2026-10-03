import { Context, Next } from 'hono';
import {
  HMAC_HANDLER_ERROR_MISSING_AUTHENTICATION_HEADERS,
  HMAC_HANDLER_ERROR_REQUEST_OUTSIDE_TIME_WINDOW,
  HMAC_HANDLER_ERROR_SIGNATURE_INVALID,
} from '@aws-access-bridge/shared/constants';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { INTERNAL_HEADER_PREFIX, INTERNAL_SIGNATURE_HEADER, INTERNAL_TIMESTAMP_HEADER } from '@aws-access-bridge/shared/constants';
import { verifyHMACSignature, hashBody } from '@aws-access-bridge/backend-data/crypto/hmac';
import { UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import type { Clock } from '@aws-access-bridge/shared/utils';

class HMACHandler {
  /**
   * @param clock Injected so a test can place a signed request inside or outside
   * the replay window deterministically. Asserting the window edge otherwise
   * means either freezing time globally or sleeping, and a test that sleeps is a
   * test that flakes.
   */
  public static async validateInternalRequest(c: Context<{ Bindings: Env }>, next: Next, clock?: Clock): Promise<void> {
    const signature: string | undefined = c.req.header(INTERNAL_SIGNATURE_HEADER);
    const timestamp: string | undefined = c.req.header(INTERNAL_TIMESTAMP_HEADER);
    if (signature && timestamp) {
      const now: number = TimestampUtil.getCurrentUnixTimestampInMilliseconds(clock);
      const requestTime: number = parseInt(timestamp);
      if (Math.abs(now - requestTime) <= ConfigurationManager.internal.getRequestTimeWindowMs(c.env)) {
        const clonedRequest = c.req.raw.clone();
        const body: string = await clonedRequest.text();
        const bodyHash: string = await hashBody(body);
        // Sign the query string too. Without it a captured, validly signed
        // request stays valid after query parameters are appended, making the
        // signature malleable — harmless for the current body-only internal
        // calls, but an auth-bypass primitive as soon as one signs a GET.
        const requestUrl: URL = new URL(c.req.url);
        const path: string = requestUrl.pathname + requestUrl.search;
        const method: string = c.req.method;
        const headers: Record<string, string> = {};
        for (const [key, value] of c.req.raw.headers.entries()) {
          if (key !== INTERNAL_SIGNATURE_HEADER && key.startsWith(INTERNAL_HEADER_PREFIX)) {
            headers[key] = value;
          }
        }
        const secret: string = await c.env.INTERNAL_REQUEST_HMAC_SECRET.get();
        const isValid: boolean = await verifyHMACSignature(secret, signature, headers, timestamp, bodyHash, path, method);
        if (isValid) {
          await next();
          return;
        }
        throw new UnauthorizedError(HMAC_HANDLER_ERROR_SIGNATURE_INVALID);
      }
      throw new UnauthorizedError(HMAC_HANDLER_ERROR_REQUEST_OUTSIDE_TIME_WINDOW);
    }
    throw new UnauthorizedError(HMAC_HANDLER_ERROR_MISSING_AUTHENTICATION_HEADERS);
  }
}

export { HMACHandler };
