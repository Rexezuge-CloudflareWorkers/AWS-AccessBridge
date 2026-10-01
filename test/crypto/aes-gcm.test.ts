import { describe, it, expect } from 'vitest';
import {
  generateAESGCMKey,
  encryptData,
  decryptData,
  decryptDataWithKeys,
  decryptDataTolerant,
} from '@aws-access-bridge/backend-data/crypto/aes-gcm';

describe('AES-GCM Crypto', () => {
  describe('generateAESGCMKey', () => {
    it('generates a base64-encoded key', async () => {
      const key = await generateAESGCMKey();
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
      // Base64 decode should give 32 bytes (256 bits)
      const decoded = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
      expect(decoded.length).toBe(32);
    });

    it('generates unique keys', async () => {
      const key1 = await generateAESGCMKey();
      const key2 = await generateAESGCMKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('encryptData / decryptData', () => {
    it('round-trips data through encrypt and decrypt', async () => {
      const key = await generateAESGCMKey();
      const plaintext = 'Hello, World!';
      const { encrypted, iv } = await encryptData(plaintext, key);
      const decrypted = await decryptData(encrypted, iv, key);
      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertext for the same plaintext with different IVs', async () => {
      const key = await generateAESGCMKey();
      const plaintext = 'test data';
      const result1 = await encryptData(plaintext, key);
      const result2 = await encryptData(plaintext, key);
      // Random IVs should differ
      expect(result1.iv).not.toBe(result2.iv);
      expect(result1.encrypted).not.toBe(result2.encrypted);
    });

    it('never reuses an IV across calls, so identical plaintexts stay unlinked', async () => {
      const key = await generateAESGCMKey();
      const plaintext = 'test data';
      const seen = new Set<string>();
      for (let i = 0; i < 25; i++) {
        const { iv } = await encryptData(plaintext, key);
        expect(seen.has(iv)).toBe(false);
        seen.add(iv);
      }
    });

    it('encrypts each field of a multi-field secret under an independent IV', async () => {
      // Regression guard for the GCM nonce-reuse flaw: encrypting accessKeyId,
      // secretAccessKey and sessionToken under one shared IV made the CTR
      // keystream identical, so XORing two ciphertexts revealed the XOR of two
      // plaintexts and the GHASH auth subkey became recoverable.
      const key = await generateAESGCMKey();
      const fields = await Promise.all([encryptData('AKIAIOSFODNN7EXAMPLE', key), encryptData('wJalrXUtnFEMI', key), encryptData('token', key)]);
      const ivs = fields.map((f) => f.iv);
      expect(new Set(ivs).size).toBe(3);
      await Promise.all(fields.map(async (f) => expect(await decryptData(f.encrypted, f.iv, key)).toBeTypeOf('string')));
    });

    it('encrypts and decrypts empty string', async () => {
      const key = await generateAESGCMKey();
      const { encrypted, iv } = await encryptData('', key);
      const decrypted = await decryptData(encrypted, iv, key);
      expect(decrypted).toBe('');
    });

    it('encrypts and decrypts unicode text', async () => {
      const key = await generateAESGCMKey();
      const plaintext = '日本語テスト 🔐 émojis';
      const { encrypted, iv } = await encryptData(plaintext, key);
      const decrypted = await decryptData(encrypted, iv, key);
      expect(decrypted).toBe(plaintext);
    });

    it('encrypts and decrypts long strings', async () => {
      const key = await generateAESGCMKey();
      const plaintext = 'A'.repeat(10000);
      const { encrypted, iv } = await encryptData(plaintext, key);
      const decrypted = await decryptData(encrypted, iv, key);
      expect(decrypted).toBe(plaintext);
    });

    it('fails to decrypt with wrong key', async () => {
      const key1 = await generateAESGCMKey();
      const key2 = await generateAESGCMKey();
      const { encrypted, iv } = await encryptData('secret', key1);
      await expect(decryptData(encrypted, iv, key2)).rejects.toThrow();
    });
  });

  describe('decryptDataWithKeys', () => {
    it('returns decrypted data when the first key authenticates', async () => {
      const key = await generateAESGCMKey();
      const { encrypted, iv } = await encryptData('secret', key);
      await expect(decryptDataWithKeys(encrypted, iv, [key])).resolves.toBe('secret');
    });

    /**
     * The migration path: a row written before the per-feature key split is still
     * encrypted under the legacy master key, which sits later in the chain.
     */
    it('falls back to a later key when the first does not authenticate', async () => {
      const legacy = await generateAESGCMKey();
      const { encrypted, iv } = await encryptData('secret', legacy);
      const current = await generateAESGCMKey();
      await expect(decryptDataWithKeys(encrypted, iv, [current, legacy])).resolves.toBe('secret');
    });

    it('throws when no key in the chain authenticates', async () => {
      const key = await generateAESGCMKey();
      const { encrypted, iv } = await encryptData('secret', key);
      const other = await generateAESGCMKey();
      await expect(decryptDataWithKeys(encrypted, iv, [other])).rejects.toThrow(/No key in the chain/);
    });

    it('throws when the ciphertext or IV is absent, rather than returning undefined', async () => {
      // Durable data: a missing envelope is a loud failure, not a soft miss.
      const key = await generateAESGCMKey();
      await expect(decryptDataWithKeys(undefined, 'iv', [key])).rejects.toThrow();
      await expect(decryptDataWithKeys('ciphertext', undefined, [key])).rejects.toThrow();
    });
  });

  describe('decryptDataTolerant', () => {
    it('returns the plaintext when the payload authenticates', async () => {
      const key = await generateAESGCMKey();
      const { encrypted, iv } = await encryptData('secret', key);
      await expect(decryptDataTolerant(encrypted, iv, [key])).resolves.toBe('secret');
    });

    it('returns undefined instead of throwing when no key in the chain verifies', async () => {
      const key = await generateAESGCMKey();
      const other = await generateAESGCMKey();
      const { encrypted, iv } = await encryptData('secret', key);
      // Wrong key: GCM authentication fails. Callers on a recoverable read path
      // (e.g. the credential cache) treat this as a miss rather than a crash.
      await expect(decryptDataTolerant(encrypted, iv, [other])).resolves.toBeUndefined();
    });

    /**
     * A cache entry written before the per-feature key split still decrypts: the
     * legacy master key sits later in the chain.
     */
    it('falls back to a later key in the chain', async () => {
      const legacy = await generateAESGCMKey();
      const { encrypted, iv } = await encryptData('secret', legacy);
      const current = await generateAESGCMKey();
      await expect(decryptDataTolerant(encrypted, iv, [current, legacy])).resolves.toBe('secret');
    });

    it('returns undefined when the ciphertext is tampered with', async () => {
      const key = await generateAESGCMKey();
      const { encrypted, iv } = await encryptData('secret', key);
      const bytes = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
      bytes[0] = bytes[0] ^ 0xff;
      await expect(decryptDataTolerant(btoa(String.fromCodePoint(...bytes)), iv, [key])).resolves.toBeUndefined();
    });

    it('returns undefined when any parameter is missing', async () => {
      const key = await generateAESGCMKey();
      const { encrypted, iv } = await encryptData('secret', key);
      await expect(decryptDataTolerant(undefined, iv, [key])).resolves.toBeUndefined();
      await expect(decryptDataTolerant(encrypted, undefined, [key])).resolves.toBeUndefined();
      await expect(decryptDataTolerant(encrypted, iv, undefined)).resolves.toBeUndefined();
      await expect(decryptDataTolerant(encrypted, iv, [])).resolves.toBeUndefined();
    });
  });
});
