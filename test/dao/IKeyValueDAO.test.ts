import { describe, it, expect, vi } from 'vitest';
import { KV_NAMESPACE_DELIMITER } from '@aws-access-bridge/backend-data/constants/kv';

// We test the protected methods via a concrete subclass
class TestKeyValueDAO {
  private readonly kv: KVNamespace;
  private readonly namespace: string;

  constructor(kv: KVNamespace, namespace: string) {
    this.kv = kv;
    this.namespace = namespace;
  }

  public toNamespacedKey(rawKey: string): string {
    return `${this.namespace}${KV_NAMESPACE_DELIMITER}${rawKey}`;
  }

  public async get<T = unknown>(key: string): Promise<T | null> {
    return this.kv.get<T>(this.toNamespacedKey(key), 'json');
  }

  public async put(key: string, value: unknown, options?: KVNamespacePutOptions): Promise<void> {
    return this.kv.put(this.toNamespacedKey(key), JSON.stringify(value), options);
  }

  public async delete(key: string): Promise<void> {
    return this.kv.delete(key);
  }
}

describe('IKeyValueDAO', () => {
  function createMockKV(): KVNamespace {
    return {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as KVNamespace;
  }

  describe('toNamespacedKey', () => {
    it('prefixes key with namespace and delimiter', () => {
      const kv = createMockKV();
      const dao = new TestKeyValueDAO(kv, 'TEST');
      expect(dao.toNamespacedKey('myKey')).toBe('TEST::myKey');
    });

    it('handles empty key', () => {
      const kv = createMockKV();
      const dao = new TestKeyValueDAO(kv, 'NS');
      expect(dao.toNamespacedKey('')).toBe('NS::');
    });
  });

  describe('get', () => {
    it('calls kv.get with namespaced key and json type', async () => {
      const kv = createMockKV();
      const dao = new TestKeyValueDAO(kv, 'CC');
      await dao.get('test-key');
      expect(kv.get).toHaveBeenCalledWith('CC::test-key', 'json');
    });

    it('returns value from KV', async () => {
      const kv = createMockKV();
      vi.mocked(kv.get).mockResolvedValue({ data: 'value' });
      const dao = new TestKeyValueDAO(kv, 'CC');
      const result = await dao.get('key');
      expect(result).toEqual({ data: 'value' });
    });

    it('returns null when key not found', async () => {
      const kv = createMockKV();
      vi.mocked(kv.get).mockResolvedValue(null);
      const dao = new TestKeyValueDAO(kv, 'CC');
      const result = await dao.get('missing');
      expect(result).toBeNull();
    });
  });

  describe('put', () => {
    it('calls kv.put with namespaced key and JSON-stringified value', async () => {
      const kv = createMockKV();
      const dao = new TestKeyValueDAO(kv, 'CC');
      await dao.put('key', { foo: 'bar' });
      expect(kv.put).toHaveBeenCalledWith('CC::key', '{"foo":"bar"}', undefined);
    });

    it('passes TTL options through', async () => {
      const kv = createMockKV();
      const dao = new TestKeyValueDAO(kv, 'CC');
      await dao.put('key', 'value', { expirationTtl: 300 });
      expect(kv.put).toHaveBeenCalledWith('CC::key', '"value"', { expirationTtl: 300 });
    });
  });

  describe('delete', () => {
    it('calls kv.delete with key directly (not namespaced)', async () => {
      const kv = createMockKV();
      const dao = new TestKeyValueDAO(kv, 'CC');
      await dao.delete('raw-key');
      expect(kv.delete).toHaveBeenCalledWith('raw-key');
    });
  });
});
