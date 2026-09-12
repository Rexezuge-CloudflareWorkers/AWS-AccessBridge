import { describe, it, expect } from 'vitest';
import { generateHMACSignature, verifyHMACSignature, hashBody } from '@aws-access-bridge/backend-data/crypto/hmac';

describe('HMAC Crypto', () => {
  const secret = 'test-hmac-secret-key';
  const timestamp = '1700000000000';
  const path = '/api/test';
  const method = 'POST';

  describe('hashBody', () => {
    it('produces a base64-encoded SHA-256 hash', async () => {
      const hash = await hashBody('test body');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('produces consistent hash for same input', async () => {
      const hash1 = await hashBody('hello');
      const hash2 = await hashBody('hello');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different inputs', async () => {
      const hash1 = await hashBody('hello');
      const hash2 = await hashBody('world');
      expect(hash1).not.toBe(hash2);
    });

    it('handles empty string', async () => {
      const hash = await hashBody('');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });
  });

  describe('generateHMACSignature', () => {
    it('generates a base64-encoded signature', async () => {
      const headers = { 'x-internal-user-email': 'user@test.com' };
      const bodyHash = await hashBody('test');
      const sig = await generateHMACSignature(secret, headers, timestamp, bodyHash, path, method);
      expect(typeof sig).toBe('string');
      expect(sig.length).toBeGreaterThan(0);
    });

    it('is deterministic for same inputs', async () => {
      const headers = { 'x-internal-user-email': 'user@test.com' };
      const bodyHash = await hashBody('test');
      const sig1 = await generateHMACSignature(secret, headers, timestamp, bodyHash, path, method);
      const sig2 = await generateHMACSignature(secret, headers, timestamp, bodyHash, path, method);
      expect(sig1).toBe(sig2);
    });

    it('produces different signature for different secret', async () => {
      const headers = { 'x-internal-user-email': 'user@test.com' };
      const bodyHash = await hashBody('test');
      const sig1 = await generateHMACSignature(secret, headers, timestamp, bodyHash, path, method);
      const sig2 = await generateHMACSignature('other-secret', headers, timestamp, bodyHash, path, method);
      expect(sig1).not.toBe(sig2);
    });

    it('produces different signature for different body', async () => {
      const headers = { 'x-internal-user-email': 'user@test.com' };
      const bodyHash1 = await hashBody('body1');
      const bodyHash2 = await hashBody('body2');
      const sig1 = await generateHMACSignature(secret, headers, timestamp, bodyHash1, path, method);
      const sig2 = await generateHMACSignature(secret, headers, timestamp, bodyHash2, path, method);
      expect(sig1).not.toBe(sig2);
    });

    it('only includes x-internal- prefixed headers in signature', async () => {
      const bodyHash = await hashBody('test');
      const headers1 = { 'x-internal-user-email': 'user@test.com', 'content-type': 'application/json' };
      const headers2 = { 'x-internal-user-email': 'user@test.com', 'content-type': 'text/plain' };
      const sig1 = await generateHMACSignature(secret, headers1, timestamp, bodyHash, path, method);
      const sig2 = await generateHMACSignature(secret, headers2, timestamp, bodyHash, path, method);
      // Non-internal headers should not affect the signature
      expect(sig1).toBe(sig2);
    });

    it('sorts internal headers alphabetically', async () => {
      const bodyHash = await hashBody('test');
      const headers1 = { 'x-internal-b': 'b-val', 'x-internal-a': 'a-val' };
      const headers2 = { 'x-internal-a': 'a-val', 'x-internal-b': 'b-val' };
      const sig1 = await generateHMACSignature(secret, headers1, timestamp, bodyHash, path, method);
      const sig2 = await generateHMACSignature(secret, headers2, timestamp, bodyHash, path, method);
      expect(sig1).toBe(sig2);
    });
  });

  describe('verifyHMACSignature', () => {
    it('returns true for valid signature', async () => {
      const headers = { 'x-internal-user-email': 'user@test.com' };
      const bodyHash = await hashBody('test');
      const sig = await generateHMACSignature(secret, headers, timestamp, bodyHash, path, method);
      const isValid = await verifyHMACSignature(secret, sig, headers, timestamp, bodyHash, path, method);
      expect(isValid).toBe(true);
    });

    it('returns false for tampered signature', async () => {
      const headers = { 'x-internal-user-email': 'user@test.com' };
      const bodyHash = await hashBody('test');
      const isValid = await verifyHMACSignature(secret, 'invalid-signature', headers, timestamp, bodyHash, path, method);
      expect(isValid).toBe(false);
    });

    it('returns false when body hash differs', async () => {
      const headers = { 'x-internal-user-email': 'user@test.com' };
      const bodyHash = await hashBody('original');
      const sig = await generateHMACSignature(secret, headers, timestamp, bodyHash, path, method);
      const tamperedHash = await hashBody('tampered');
      const isValid = await verifyHMACSignature(secret, sig, headers, timestamp, tamperedHash, path, method);
      expect(isValid).toBe(false);
    });

    it('returns false when path differs', async () => {
      const headers = { 'x-internal-user-email': 'user@test.com' };
      const bodyHash = await hashBody('test');
      const sig = await generateHMACSignature(secret, headers, timestamp, bodyHash, '/api/original', method);
      const isValid = await verifyHMACSignature(secret, sig, headers, timestamp, bodyHash, '/api/tampered', method);
      expect(isValid).toBe(false);
    });

    it('returns false when method differs', async () => {
      const headers = { 'x-internal-user-email': 'user@test.com' };
      const bodyHash = await hashBody('test');
      const sig = await generateHMACSignature(secret, headers, timestamp, bodyHash, path, 'POST');
      const isValid = await verifyHMACSignature(secret, sig, headers, timestamp, bodyHash, path, 'GET');
      expect(isValid).toBe(false);
    });
  });
});
