import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CredentialsCacheDAO } from '@aws-access-bridge/backend-data/dao/CredentialsCacheDAO';
import { encryptData, generateAESGCMKey } from '@aws-access-bridge/backend-data/crypto/aes-gcm';
import { TimestampUtil } from '@aws-access-bridge/shared/utils/TimestampUtil';
import { KV_NAMESPACE_CREDENTIAL_CACHE, KV_NAMESPACE_DELIMITER } from '@aws-access-bridge/backend-data/constants/kv';

const PRINCIPAL_ARN = 'arn:aws:iam::123456789012:role/Cached';

describe('CredentialsCacheDAO', () => {
  let store: Map<string, string>;
  let kv: KVNamespace;
  let key: string;

  beforeEach(() => {
    store = new Map();
    key = btoa(String.fromCodePoint(...crypto.getRandomValues(new Uint8Array(32))));
    kv = {
      // Mirrors real KV: requesting type 'json' yields a parsed value.
      get: vi.fn((k: string, type?: string) => {
        const raw = store.get(k);
        if (raw === undefined) {
          return Promise.resolve(null);
        }
        return Promise.resolve(type === 'json' ? JSON.parse(raw) : raw);
      }),
      put: vi.fn((k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve();
      }),
      delete: vi.fn((k: string) => {
        store.delete(k);
        return Promise.resolve();
      }),
    } as unknown as KVNamespace;
  });

  function cacheKey(): string {
    return `${KV_NAMESPACE_CREDENTIAL_CACHE}${KV_NAMESPACE_DELIMITER}${PRINCIPAL_ARN}`;
  }

  it('round-trips a credential with a distinct IV per field', async () => {
    const dao = new CredentialsCacheDAO(kv, [key]);
    const expiresAt = TimestampUtil.getCurrentUnixTimestampInSeconds() + 3600;
    await dao.storeCachedCredential({ principalArn: PRINCIPAL_ARN, accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG', sessionToken: 'session-token', expiresAt });

    const raw = JSON.parse(store.get(cacheKey()) ?? '{}') as Record<string, string>;
    expect(new Set([raw.salt, raw.saltSecretAccessKey, raw.saltSessionToken]).size).toBe(3);

    await expect(dao.getCachedCredential(PRINCIPAL_ARN)).resolves.toEqual({
      principalArn: PRINCIPAL_ARN,
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG',
      sessionToken: 'session-token',
      expiresAt,
    });
  });

  it('decrypts a pre-migration entry that carries only the shared salt', async () => {
    // Backward-read compatibility for cache entries written before IVs were
    // split per field: one `salt` encrypted all three fields and the per-field
    // salt columns are absent entirely.
    const dao = new CredentialsCacheDAO(kv, [key]);
    const expiresAt = TimestampUtil.getCurrentUnixTimestampInSeconds() + 3600;
    const sharedIv = btoa(String.fromCodePoint(...crypto.getRandomValues(new Uint8Array(12))));
    store.set(
      cacheKey(),
      JSON.stringify({
        encryptedAccessKeyId: await encryptWithIv('AKIAIOSFODNN7EXAMPLE', key, sharedIv),
        encryptedSecretAccessKey: await encryptWithIv('wJalrXUtnFEMI/K7MDENG', key, sharedIv),
        encryptedSessionToken: await encryptWithIv('session-token', key, sharedIv),
        salt: sharedIv,
        expiresAt,
      }),
    );

    await expect(dao.getCachedCredential(PRINCIPAL_ARN)).resolves.toMatchObject({
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG',
      sessionToken: 'session-token',
    });
  });

  it('accepts a credential with no session token', async () => {
    // An absent session token must not be mistaken for a corrupt entry — only
    // a present-but-unreadable field is corruption.
    const dao = new CredentialsCacheDAO(kv, [key]);
    const expiresAt = TimestampUtil.getCurrentUnixTimestampInSeconds() + 3600;
    const accessKeyId = await encryptData('AKIA', key);
    const secretAccessKey = await encryptData('SECRET', key);
    store.set(
      cacheKey(),
      JSON.stringify({
        encryptedAccessKeyId: accessKeyId.encrypted,
        encryptedSecretAccessKey: secretAccessKey.encrypted,
        salt: accessKeyId.iv,
        saltSecretAccessKey: secretAccessKey.iv,
        expiresAt,
      }),
    );

    await expect(dao.getCachedCredential(PRINCIPAL_ARN)).resolves.toMatchObject({ accessKeyId: 'AKIA', secretAccessKey: 'SECRET', sessionToken: undefined });
  });

  it('treats an undecryptable entry as a miss and evicts it', async () => {
    // A corrupt or key-rotated entry must not break the assume-role path; the
    // chain can always be re-resolved for the principal ARN.
    const dao = new CredentialsCacheDAO(kv, [key]);
    const expiresAt = TimestampUtil.getCurrentUnixTimestampInSeconds() + 3600;
    const other = await generateAESGCMKey();
    const foreign = await encryptData('AKIAIOSFODNN7EXAMPLE', other);
    store.set(
      cacheKey(),
      JSON.stringify({
        encryptedAccessKeyId: foreign.encrypted,
        encryptedSecretAccessKey: foreign.encrypted,
        encryptedSessionToken: foreign.encrypted,
        salt: foreign.iv,
        saltSecretAccessKey: foreign.iv,
        saltSessionToken: foreign.iv,
        expiresAt,
      }),
    );

    await expect(dao.getCachedCredential(PRINCIPAL_ARN)).resolves.toBeUndefined();
    expect(store.has(cacheKey())).toBe(false);
  });

  it('evicts an expired entry', async () => {
    const dao = new CredentialsCacheDAO(kv, [key]);
    await dao.storeCachedCredential({ principalArn: PRINCIPAL_ARN, accessKeyId: 'AKIA', secretAccessKey: 'SECRET', sessionToken: 'TOKEN', expiresAt: TimestampUtil.getCurrentUnixTimestampInSeconds() - 10 });
    await expect(dao.getCachedCredential(PRINCIPAL_ARN)).resolves.toBeUndefined();
    expect(store.has(cacheKey())).toBe(false);
  });
});

/**
Build a ciphertext with a caller-chosen IV, as pre-fix code did.
*/
async function encryptWithIv(data: string, keyBase64: string, ivBase64: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(keyBase64), (c) => c.codePointAt(0) ?? 0), { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: Uint8Array.from(atob(ivBase64), (c) => c.codePointAt(0) ?? 0) }, key, new TextEncoder().encode(data));
  return btoa(String.fromCodePoint(...new Uint8Array(encrypted)));
}
