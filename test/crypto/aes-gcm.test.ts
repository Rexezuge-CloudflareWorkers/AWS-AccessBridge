import { describe, it, expect } from 'vitest';
import { generateAESGCMKey, encryptData, decryptData, decryptDataOptional } from '@aws-access-bridge/backend-data/crypto/aes-gcm';

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

    it('produces same ciphertext when same IV is reused', async () => {
      const key = await generateAESGCMKey();
      const plaintext = 'test data';
      const result1 = await encryptData(plaintext, key);
      const result2 = await encryptData(plaintext, key, result1.iv);
      expect(result2.iv).toBe(result1.iv);
      expect(result2.encrypted).toBe(result1.encrypted);
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

  describe('decryptDataOptional', () => {
    it('returns decrypted data when all parameters provided', async () => {
      const key = await generateAESGCMKey();
      const { encrypted, iv } = await encryptData('secret', key);
      const result = await decryptDataOptional(encrypted, iv, key);
      expect(result).toBe('secret');
    });

    it('returns undefined when encrypted is undefined', async () => {
      const result = await decryptDataOptional(undefined, 'iv', 'key');
      expect(result).toBeUndefined();
    });

    it('returns undefined when iv is undefined', async () => {
      const result = await decryptDataOptional('encrypted', undefined, 'key');
      expect(result).toBeUndefined();
    });

    it('returns undefined when key is undefined', async () => {
      const result = await decryptDataOptional('encrypted', 'iv', undefined);
      expect(result).toBeUndefined();
    });

    it('returns undefined when all parameters are undefined', async () => {
      const result = await decryptDataOptional(undefined, undefined, undefined);
      expect(result).toBeUndefined();
    });
  });
});
