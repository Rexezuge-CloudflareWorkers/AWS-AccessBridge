import { KV_NAMESPACE_DELIMITER, KV_VALUE_TYPE_JSON } from '@aws-access-bridge/backend-data/constants/kv';

abstract class IKeyValueDAO {
  protected readonly kv: KVNamespace;
  protected readonly namespace: string;

  constructor(kv: KVNamespace, namespace: string) {
    this.kv = kv;
    this.namespace = namespace;
  }

  protected async get<ExpectedValue = unknown>(key: string): Promise<ExpectedValue | null> {
    return this.kv.get<ExpectedValue>(this.toNamespacedKey(key), KV_VALUE_TYPE_JSON);
  }

  protected async put(key: string, value: unknown, options?: KVNamespacePutOptions): Promise<void> {
    return this.kv.put(this.toNamespacedKey(key), JSON.stringify(value), options);
  }

  protected async delete(key: string): Promise<void> {
    return this.kv.delete(key);
  }

  protected toNamespacedKey(rawKey: string): string {
    return `${this.namespace}${KV_NAMESPACE_DELIMITER}${rawKey}`;
  }
}

export { IKeyValueDAO };
