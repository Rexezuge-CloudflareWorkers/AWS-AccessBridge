import { describe, it, expect, vi } from 'vitest';
import { HMACHandler } from '@/middleware/HMACHandler';
import {
  HMAC_HANDLER_ERROR_MISSING_AUTHENTICATION_HEADERS,
  HMAC_HANDLER_ERROR_REQUEST_OUTSIDE_TIME_WINDOW,
  HMAC_HANDLER_ERROR_REQUEST_REPLAYED,
  HMAC_HANDLER_ERROR_SIGNATURE_INVALID,
} from '@aws-access-bridge/shared/constants';
import { INTERNAL_SIGNATURE_HEADER, INTERNAL_TIMESTAMP_HEADER } from '@aws-access-bridge/shared/constants';
import { UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { generateHMACSignature, hashBody } from '@aws-access-bridge/backend-data/crypto/hmac';
import { ReplayGuard } from '@aws-access-bridge/backend-services/auth/ReplayGuard';
import { FixedClock } from '@aws-access-bridge/shared/utils/Clock';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';

/**
 * One frozen instant for the suite, so the replay window's exact edge is just
 * another number rather than something only a sleeping test could probe.
 */
const NOW = 1_704_067_200_000;

function fakeKv() {
  const store = new Map<string, string>();
  const kv = {
    get: (key: string): Promise<string | null> => Promise.resolve(store.get(key) ?? null),
    put: (key: string, value: string): Promise<void> => {
      store.set(key, value);
      return Promise.resolve();
    },
  } as unknown as KVNamespace;
  return { store, kv };
}

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

  /**
   * The timestamp window bounds *how long* a captured request stays replayable;
   * it cannot stop a replay inside that window. These cover the guard that does.
   */
  describe('replay protection', () => {
    const SECRET = 'test-hmac-secret';

    async function signedContext() {
      const timestamp = NOW.toString();
      const body = '{"principalArn":"arn:aws:iam::123456789012:role/Dev"}';
      const signedHeaders: Record<string, string> = {
        'x-internal-user-email': 'user@example.com',
        [INTERNAL_TIMESTAMP_HEADER]: timestamp,
      };
      const signature = await generateHMACSignature(
        SECRET,
        signedHeaders,
        timestamp,
        await hashBody(body),
        '/api/aws/assume-role',
        'POST',
      );
      const headers = { ...signedHeaders, [INTERNAL_SIGNATURE_HEADER]: signature };
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

    it('rejects the same signature presented twice', async () => {
      const { kv } = fakeKv();
      const guard = new ReplayGuard(kv);
      const next = vi.fn();

      await HMACHandler.validateInternalRequest((await signedContext()) as never, next, new FixedClock(NOW), guard);
      expect(next).toHaveBeenCalledOnce();

      await expect(
        HMACHandler.validateInternalRequest((await signedContext()) as never, next, new FixedClock(NOW), guard),
      ).rejects.toThrow(HMAC_HANDLER_ERROR_REQUEST_REPLAYED);
      // The replay must not have reached the handler a second time.
      expect(next).toHaveBeenCalledOnce();
    });

    it('claims only a verified signature, so a forgery cannot poison the seen-set', async () => {
      // Claiming before verifying would let an unauthenticated caller present a
      // captured signature once and make the real request fail.
      const { kv, store } = fakeKv();
      const guard = new ReplayGuard(kv);
      const forged = await signedContext();
      (forged.req as { header: (name: string) => string | undefined }).header = (name: string) =>
        name === INTERNAL_SIGNATURE_HEADER ? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' : NOW.toString();

      await expect(HMACHandler.validateInternalRequest(forged as never, vi.fn(), new FixedClock(NOW), guard)).rejects.toThrow(
        HMAC_HANDLER_ERROR_SIGNATURE_INVALID,
      );
      expect(store.size).toBe(0);

      // The genuine request therefore still works.
      await expect(HMACHandler.validateInternalRequest((await signedContext()) as never, vi.fn(), new FixedClock(NOW), guard)).resolves.toBeUndefined();
    });

    it('still verifies when no guard is supplied', async () => {
      const next = vi.fn();
      await expect(HMACHandler.validateInternalRequest((await signedContext()) as never, next, new FixedClock(NOW))).resolves.toBeUndefined();
      expect(next).toHaveBeenCalledOnce();
    });
  });
});
