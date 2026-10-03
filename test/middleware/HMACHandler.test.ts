import { describe, it, expect, vi } from 'vitest';
import { HMACHandler } from '@/middleware/HMACHandler';
import {
  HMAC_HANDLER_ERROR_MISSING_AUTHENTICATION_HEADERS,
  HMAC_HANDLER_ERROR_REQUEST_OUTSIDE_TIME_WINDOW,
  HMAC_HANDLER_ERROR_SIGNATURE_INVALID,
} from '@aws-access-bridge/shared/constants';
import { INTERNAL_SIGNATURE_HEADER, INTERNAL_TIMESTAMP_HEADER } from '@aws-access-bridge/shared/constants';
import { UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { generateHMACSignature, hashBody } from '@aws-access-bridge/backend-data/crypto/hmac';
import { FixedClock } from '@aws-access-bridge/shared/utils/Clock';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';

// Test the error cases of HMACHandler by testing behavior at the constant/logic level
// Full integration tests with Hono context require more complex setup

describe('HMACHandler constants and validation logic', () => {
  describe('error messages', () => {
    it('missing authentication headers error is descriptive', () => {
      expect(HMAC_HANDLER_ERROR_MISSING_AUTHENTICATION_HEADERS).toBe('Missing internal authentication headers');
    });

    it('request outside time window error is descriptive', () => {
      expect(HMAC_HANDLER_ERROR_SIGNATURE_INVALID).toBe('Internal request signature invalid');
    });
  });

  describe('header detection', () => {
    it('signature and timestamp headers follow internal prefix convention', () => {
      expect(INTERNAL_SIGNATURE_HEADER).toMatch(/^x-internal-/);
      expect(INTERNAL_TIMESTAMP_HEADER).toMatch(/^x-internal-/);
    });
  });

  describe('error types', () => {
    it('throws UnauthorizedError for missing headers', () => {
      const error = new UnauthorizedError(HMAC_HANDLER_ERROR_MISSING_AUTHENTICATION_HEADERS);
      expect(error.getErrorCode()).toBe(401);
      expect(error.getErrorType()).toBe('Unauthorized');
    });
  });

  describe('validateInternalRequest', () => {
    const SECRET = 'test-hmac-secret';

    async function signedContext(overrides?: { timestamp?: string; signature?: string; omitAuth?: boolean }) {
      const timestamp = overrides?.timestamp ?? NOW.toString();
      const body = '{"principalArn":"arn:aws:iam::123456789012:role/Dev"}';
      const signedHeaders: Record<string, string> = {
        'x-internal-user-email': 'user@example.com',
        [INTERNAL_TIMESTAMP_HEADER]: timestamp,
      };
      const bodyHash = await hashBody(body);
      const signature =
        overrides?.signature ?? (await generateHMACSignature(SECRET, signedHeaders, timestamp, bodyHash, '/api/aws/assume-role', 'POST'));
      const headers: Record<string, string> = { ...signedHeaders, [INTERNAL_SIGNATURE_HEADER]: signature };
      if (overrides?.omitAuth) {
        delete headers[INTERNAL_SIGNATURE_HEADER];
        delete headers[INTERNAL_TIMESTAMP_HEADER];
      }
      const raw = new Request('https://self.invalid/api/aws/assume-role', { method: 'POST', headers, body });
      return {
        req: {
          header: (name: string) => raw.headers.get(name) ?? undefined,
          raw,
          url: raw.url,
          method: 'POST',
        },
        env: { INTERNAL_REQUEST_HMAC_SECRET: { get: async () => SECRET } },
      };
    }

    /**
     * One frozen instant for the whole suite, injected via `Clock`. These
     * assertions previously read `Date.now()` directly, which made the
     * *boundary* of the replay window untestable — the only way to probe it was
     * to sleep and hope, or to assert only a comfortably-outside case. With a
     * `FixedClock` the exact edge is just another number.
     */
    const NOW = 1_704_067_200_000;
    const WINDOW_MS = ConfigurationManager.internal.getRequestTimeWindowMs({});

    it('calls next for valid signatures', async () => {
      const next = vi.fn();
      const c = (await signedContext()) as never;
      await HMACHandler.validateInternalRequest(c, next, new FixedClock(NOW));
      expect(next).toHaveBeenCalledOnce();
    });

    it('throws missing-headers error without auth headers', async () => {
      const next = vi.fn();
      const c = (await signedContext({ omitAuth: true })) as never;
      await expect(HMACHandler.validateInternalRequest(c, next, new FixedClock(NOW))).rejects.toThrow(
        HMAC_HANDLER_ERROR_MISSING_AUTHENTICATION_HEADERS,
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('throws time-window error for stale timestamps', async () => {
      const next = vi.fn();
      const c = (await signedContext({ timestamp: (NOW - 60_000).toString() })) as never;
      await expect(HMACHandler.validateInternalRequest(c, next, new FixedClock(NOW))).rejects.toThrow(HMAC_HANDLER_ERROR_REQUEST_OUTSIDE_TIME_WINDOW);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a timestamp from the future past the window', async () => {
      // The window is symmetric via `Math.abs`, so a far-future timestamp must
      // be refused too — otherwise a client could set an arbitrarily large clock
      // skew and have its signatures accepted indefinitely.
      const next = vi.fn();
      const c = (await signedContext({ timestamp: (NOW + 60_000).toString() })) as never;
      await expect(HMACHandler.validateInternalRequest(c, next, new FixedClock(NOW))).rejects.toThrow(HMAC_HANDLER_ERROR_REQUEST_OUTSIDE_TIME_WINDOW);
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts a request exactly on the window edge', async () => {
      // The comparison is `<=`, so the boundary itself is in-window. Without a
      // pinned clock this is the assertion that could not be written at all.
      const next = vi.fn();
      const c = (await signedContext({ timestamp: (NOW - WINDOW_MS).toString() })) as never;
      await HMACHandler.validateInternalRequest(c, next, new FixedClock(NOW));
      expect(next).toHaveBeenCalledOnce();
    });

    it('rejects one millisecond past the window edge', async () => {
      const next = vi.fn();
      const c = (await signedContext({ timestamp: (NOW - WINDOW_MS - 1).toString() })) as never;
      await expect(HMACHandler.validateInternalRequest(c, next, new FixedClock(NOW))).rejects.toThrow(HMAC_HANDLER_ERROR_REQUEST_OUTSIDE_TIME_WINDOW);
      expect(next).not.toHaveBeenCalled();
    });

    it('throws signature-invalid error for forged signatures', async () => {
      const next = vi.fn();
      const c = (await signedContext({ signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' })) as never;
      await expect(HMACHandler.validateInternalRequest(c, next, new FixedClock(NOW))).rejects.toThrow(HMAC_HANDLER_ERROR_SIGNATURE_INVALID);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
