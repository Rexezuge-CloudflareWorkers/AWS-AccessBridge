import { describe, it, expect, vi } from 'vitest';
import { IKeyValueDAO } from '@aws-access-bridge/backend-data/dao/IKeyValueDAO';
import { KV_NAMESPACE_DELIMITER } from '@aws-access-bridge/backend-data/constants/kv';

/**
 * Exercises the real base class. An earlier version of this file re-declared a
 * lookalike class with its own copies of get/put/delete, which is why the
 * namespacing bug in `delete` survived: the test asserted the copy's behaviour,
 * not the production code's.
 */
class ExposedKeyValueDAO extends IKeyValueDAO {
  public async read<T = unknown>(key: string): Promise<T | null> {
    return this.get<T>(key);
  }

  public async write(key: string, value: unknown, options?: KVNamespacePutOptions): Promise<void> {
    return this.put(key, value, options);
  }

  public async remove(key: string): Promise<void> {
    return this.delete(key);
  }

  public namespacedKey(rawKey: string): string {
    return this.toNamespacedKey(rawKey);
  }
}

/**
 * `get` narrowed to the single shape this file exercises.
 */
type KvGet = (key: string, type?: string) => Promise<unknown>;

function createMockKV(): KVNamespace {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  };
}

describe('IKeyValueDAO', () => {
  describe('toNamespacedKey', () => {
    it('prefixes the key with the namespace and delimiter', () => {
      const dao = new ExposedKeyValueDAO(createMockKV(), 'TEST');
      expect(dao.namespacedKey('myKey')).toBe(`TEST${KV_NAMESPACE_DELIMITER}myKey`);
    });

    it('handles an empty key', () => {
      const dao = new ExposedKeyValueDAO(createMockKV(), 'NS');
      expect(dao.namespacedKey('')).toBe(`NS${KV_NAMESPACE_DELIMITER}`);
    });
  });

  describe('get', () => {
    it('requests the namespaced key with the json type', async () => {
      const kv = createMockKV();
      await new ExposedKeyValueDAO(kv, 'CC').read('test-key');
      expect(kv.get).toHaveBeenCalledWith(`CC${KV_NAMESPACE_DELIMITER}test-key`, 'json');
    });

    it('returns the stored value, and null when absent', async () => {
      const kv = createMockKV();
      // `KVNamespace.get` carries eleven overloads, and `vi.mocked` types the mock from
      // the **last** one — `get(key: Array<Key>, type: 'text')`, returning a `Map`. So
      // `mockResolvedValue` demanded a `Map` for a call that resolves one value. The
      // overload the DAO actually calls is the `'json'` one; erasing the set to it is
      // what the double means, and doing it here keeps the assertion about the value
      // rather than about TypeScript's overload resolution order.
      vi.mocked(kv.get as KvGet).mockResolvedValue({ data: 'value' });
      const dao = new ExposedKeyValueDAO(kv, 'CC');
      await expect(dao.read('key')).resolves.toEqual({ data: 'value' });

      vi.mocked(kv.get as KvGet).mockResolvedValue(null);
      await expect(dao.read('missing')).resolves.toBeNull();
    });
  });

  describe('put', () => {
    it('writes a JSON-stringified value under the namespaced key', async () => {
      const kv = createMockKV();
      await new ExposedKeyValueDAO(kv, 'CC').write('key', { foo: 'bar' });
      expect(kv.put).toHaveBeenCalledWith(`CC${KV_NAMESPACE_DELIMITER}key`, '{"foo":"bar"}', undefined);
    });

    it('passes TTL options through', async () => {
      const kv = createMockKV();
      await new ExposedKeyValueDAO(kv, 'CC').write('key', 'value', { expirationTtl: 300 });
      expect(kv.put).toHaveBeenCalledWith(`CC${KV_NAMESPACE_DELIMITER}key`, '"value"', { expirationTtl: 300 });
    });
  });

  describe('delete', () => {
    it('deletes the namespaced key, matching get and put', async () => {
      // Regression guard: `delete` used to pass the raw key to kv.delete while
      // get/put namespaced it, so every delete silently no-oped and entries
      // were never actually evicted.
      const kv = createMockKV();
      await new ExposedKeyValueDAO(kv, 'CC').remove('raw-key');
      expect(kv.delete).toHaveBeenCalledWith(`CC${KV_NAMESPACE_DELIMITER}raw-key`);
    });
  });
});
