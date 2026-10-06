import { describe, it, expect } from 'vitest';
import { REPLAY_TTL_SECONDS, ReplayGuard } from '@aws-access-bridge/backend-services/auth/ReplayGuard';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';

/**
 * Minimal `KVNamespace` double. Only the two operations the guard uses are
 * implemented; the cast is deliberate because the real interface carries dozens
 * of members this test has no business faking.
 */
function fakeKv() {
  const store = new Map<string, { value: string; expirationTtl?: number }>();
  const firstEntry = (): { value: string; expirationTtl?: number } | undefined => store.values().next().value;
  const firstKey = (): string | undefined => store.keys().next().value;
  const kv = {
    get: (key: string): Promise<string | null> => Promise.resolve(store.get(key)?.value ?? null),
    put: (key: string, value: string, options?: { expirationTtl?: number }): Promise<void> => {
      store.set(key, { value, expirationTtl: options?.expirationTtl });
      return Promise.resolve();
    },
  } as unknown as KVNamespace;
  return { firstEntry, firstKey, kv, store };
}

describe('ReplayGuard', () => {
  it('claims a signature the first time it is presented', async () => {
    const { kv } = fakeKv();
    await expect(new ReplayGuard(kv).claim('sig-abc')).resolves.toBe(true);
  });

  it('refuses a signature that has already been accepted', async () => {
    // The property the ±timestamp window cannot provide: inside the window a
    // captured request is still replayable, and `authenticateApiIdentity` trusts
    // the user-email header it carries.
    const { kv } = fakeKv();
    const guard = new ReplayGuard(kv);
    await expect(guard.claim('sig-abc')).resolves.toBe(true);
    await expect(guard.claim('sig-abc')).resolves.toBe(false);
  });

  it('keeps distinct signatures independent', async () => {
    const { kv } = fakeKv();
    const guard = new ReplayGuard(kv);
    await expect(guard.claim('sig-a')).resolves.toBe(true);
    await expect(guard.claim('sig-b')).resolves.toBe(true);
    await expect(guard.claim('sig-a')).resolves.toBe(false);
  });

  /**
   * The record must outlive the replay window, or a signature could age out and
   * become replayable again inside a window that is still open.
   */
  it('expires the record well after the configured replay window', async () => {
    const { firstEntry, kv } = fakeKv();
    await new ReplayGuard(kv).claim('sig-abc');
    expect(firstEntry()?.expirationTtl).toBe(REPLAY_TTL_SECONDS);
    // Compared against the *configured* window in seconds, so raising
    // `INTERNAL_REQUEST_VALID_TIME_WINDOW_MILLISECONDS` cannot silently outrun
    // the TTL and reopen the replay it exists to close.
    const windowSeconds = ConfigurationManager.internal.getRequestTimeWindowMs({}) / 1000;
    expect(REPLAY_TTL_SECONDS).toBeGreaterThan(windowSeconds * 60);
  });

  it('namespaces its keys, so it cannot collide with the credential cache', async () => {
    const { firstKey, kv } = fakeKv();
    await new ReplayGuard(kv).claim('sig-abc');
    expect(firstKey()).toBe('RP:sig-abc');
  });

  /**
   * Failing open is deliberate and asserted rather than assumed: the timestamp
   * window still bounds replay, so degrading to "accept" keeps the internal
   * surface available rather than turning a KV outage into a total loss of
   * `/api/*` self-calls.
   */
  it('accepts when the binding is absent', async () => {
    await expect(new ReplayGuard(undefined).claim('sig-abc')).resolves.toBe(true);
  });

  it('accepts rather than throwing when KV fails', async () => {
    const failing = {
      get: (): Promise<never> => Promise.reject(new Error('KV unavailable')),
      put: (): Promise<never> => Promise.reject(new Error('KV unavailable')),
    } as unknown as KVNamespace;
    await expect(new ReplayGuard(failing).claim('sig-abc')).resolves.toBe(true);
  });
});