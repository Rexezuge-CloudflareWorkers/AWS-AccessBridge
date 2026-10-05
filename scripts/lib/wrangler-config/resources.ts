import { writeFileSync } from 'node:fs';
import { parse } from 'jsonc-parser';
import {
  CONFIG_PATH,
  DEFAULT_HEX_ID,
  DEFAULT_KV_NAMESPACE_NAMES,
  DEFAULT_SECRET_STORE_NAME,
  DEFAULT_UUID,
  DEFAULT_WORKER_NAME,
  type D1Database,
  type KVNamespace,
  type SecretStore,
  type WranglerConfig,
} from './types';
import { parseJsonArray, runWrangler } from './cli';
import { parseWranglerTableRows } from '../wrangler-table';
import { readConfig, writeConfigValue } from './patches';

/**
 * `wrangler d1 list` has used several id fields across versions.
 */
export function getD1Id(database: D1Database): string | undefined {
  return database.uuid ?? database.database_id ?? database.id;
}

export function listD1Databases(): D1Database[] {
  return parseJsonArray<D1Database>(runWrangler(['d1', 'list', '--json']), 'wrangler d1 list --json');
}

/**
 * Finds the named database, creating it when absent, and returns its id.
 */
/**
 * What `ensure*` did, so a caller can act on the difference.
 *
 * The backup workflow needs to know whether the D1 database **existed** or was created
 * moments ago: a database that was just provisioned holds no user data, and uploading
 * that empty dump is a false sense of safety. That used to be inferred by re-reading the
 * placeholder id out of `wrangler.jsonc` — which is unreachable, because this very
 * function patches the placeholder away before the reader ever runs. So the fact is
 * returned here instead of re-derived from an artefact this call has already changed.
 */
export interface Provisioned {
  id: string;
  created: boolean;
}

export function ensureD1Database(databaseName: string): Provisioned {
  let database = listD1Databases().find((candidate) => candidate.name === databaseName);
  let created = false;
  if (!database) {
    console.log(`Creating D1 database: ${databaseName}`);
    runWrangler(['d1', 'create', databaseName]);
    database = listD1Databases().find((candidate) => candidate.name === databaseName);
    created = true;
  }

  const databaseId = database ? getD1Id(database) : undefined;
  if (!databaseId) {
    throw new Error(`Unable to discover D1 database ID for ${databaseName}.`);
  }
  return { id: databaseId, created };
}

export function listKVNamespaces(): KVNamespace[] {
  return parseJsonArray<KVNamespace>(runWrangler(['kv', 'namespace', 'list']), 'wrangler kv namespace list');
}

/**
 * The name to provision for a binding, from the table or derived from the worker.
 */
export function getKVNamespaceName(config: WranglerConfig, binding: string): string {
  return DEFAULT_KV_NAMESPACE_NAMES[binding] ?? `${config.name ?? DEFAULT_WORKER_NAME}-${binding.toLowerCase()}`;
}

/**
 * Finds or creates the namespace backing a binding.
 *
 * Several candidate names are accepted because a namespace may already have
 * been created under the older derived name, and renaming it would drop every
 * cached credential in it.
 */
export function ensureKVNamespace(config: WranglerConfig, binding: string): Provisioned {
  const namespaceName = getKVNamespaceName(config, binding);
  const candidateNames = new Set([namespaceName, `${config.name ?? DEFAULT_WORKER_NAME}-${binding}`, binding]);
  let namespace = listKVNamespaces().find((candidate) => {
    const candidateName = candidate.title ?? candidate.name;
    return candidate.id && candidateName && candidateNames.has(candidateName);
  });
  let created = false;
  if (!namespace) {
    console.log(`Creating KV namespace: ${namespaceName}`);
    runWrangler(['kv', 'namespace', 'create', namespaceName]);
    namespace = listKVNamespaces().find((candidate) => candidate.id && (candidate.title ?? candidate.name) === namespaceName);
    created = true;
  }

  if (!namespace?.id) {
    throw new Error(`Unable to discover KV namespace ID for ${namespaceName}.`);
  }
  return { id: namespace.id, created };
}

export function getRequiredKvBindings(): string[] {
  return Object.keys(DEFAULT_KV_NAMESPACE_NAMES);
}

/**
 * Injects bindings the worker requires but the supplied config omits.
 *
 * A `WRANGLER_JSONC` override that predates the KV bindings would otherwise
 * deploy a worker missing `AccessBridgeKV`, failing at the first cache read
 * rather than at config preparation.
 */
export function ensureRequiredKvBindings(content: string, config: WranglerConfig): string {
  const existing = new Set((config.kv_namespaces ?? []).map((namespace) => namespace.binding).filter(Boolean));
  const missing = getRequiredKvBindings().filter((binding) => !existing.has(binding));
  if (missing.length === 0) {
    return content;
  }

  const next = [...(config.kv_namespaces ?? [])];
  for (const binding of missing) {
    console.log(`Adding missing KV namespace binding: ${binding}`);
    next.push({ binding, id: DEFAULT_HEX_ID });
  }
  return writeConfigValue(content, ['kv_namespaces'], next);
}

/**
 * Reads `wrangler secrets-store store list` table output.
 *
 * Store ids are 32 hex characters; a row without one is a header, a border, or
 * an unrelated column, and is skipped rather than stored with an undefined id.
 */
export function parseSecretStoresTable(output: string): SecretStore[] {
  const stores: SecretStore[] = [];
  for (const row of parseWranglerTableRows(output)) {
    const name = row[0];
    const id = row[1];
    if (name && id && /^[a-f0-9]{32}$/i.test(id)) {
      stores.push({ name, id });
    }
  }
  return stores;
}

export function listSecretStores(): SecretStore[] {
  const output = runWrangler(['secrets-store', 'store', 'list', '--remote']);
  try {
    return parseJsonArray<SecretStore>(output, 'wrangler secrets-store store list --remote');
  } catch {
    // The subcommand prints a table rather than JSON on some versions.
    return parseSecretStoresTable(output);
  }
}

/**
 * Finds or creates the Secrets Store and returns its id.
 */
export function ensureSecretStore(): string {
  let stores = listSecretStores();
  const existing = stores.find((candidate) => candidate.name === DEFAULT_SECRET_STORE_NAME) ?? stores[0];
  if (existing) {
    return existing.id;
  }

  console.log(`Creating Secrets Store: ${DEFAULT_SECRET_STORE_NAME}`);
  const output = runWrangler(['secrets-store', 'store', 'create', DEFAULT_SECRET_STORE_NAME, '--remote']);
  const createdStoreId = /ID:\s*([a-f0-9]{32})/i.exec(output)?.[1];
  if (createdStoreId) {
    return createdStoreId;
  }

  stores = listSecretStores();
  const store = stores.find((candidate) => candidate.name === DEFAULT_SECRET_STORE_NAME) ?? stores[0];
  if (!store?.id) {
    throw new Error(`Unable to discover Secrets Store ID for ${DEFAULT_SECRET_STORE_NAME}.`);
  }
  return store.id;
}

/**
 * Replaces every placeholder id in `wrangler.jsonc` with a real one, creating
 * the underlying resource when it does not exist.
 *
 * Each section is re-parsed after writing, because `jsonc-parser.modify`
 * returns new text and the index positions shift when a section grows — reading
 * a stale `config` would patch the wrong entry after the first insertion.
 */
export function provisionWranglerResources(): string[] {
  // Every resource this call had to create, as `<kind>:<name>`. Returned rather than
  // logged, because a caller acts on it: the backup workflow refuses to export a D1
  // database that appears here, since one created moments ago holds no user data and an
  // empty dump uploaded on schedule is a false sense of safety.
  const created: string[] = [];
  let { content, config } = readConfig();

  // KV namespaces — inject required bindings missing from custom configs
  // (e.g. WRANGLER_JSONC without kv_namespaces) so CD auto-creates them.
  content = ensureRequiredKvBindings(content, config);
  config = parse(content) as WranglerConfig;

  const databaseEntries = config.d1_databases?.entries() ?? [];
  for (const [index, database] of databaseEntries) {
    if (database.database_id !== DEFAULT_UUID) {
      continue;
    }
    if (!database.database_name) {
      throw new Error(`D1 database binding ${database.binding ?? index} has a placeholder database_id but no database_name.`);
    }

    const resolved = ensureD1Database(database.database_name);
    if (resolved.created) {
      created.push(`d1:${database.database_name}`);
    }
    console.log(`Using D1 database ${database.database_name}: ${resolved.id}`);
    content = writeConfigValue(content, ['d1_databases', index, 'database_id'], resolved.id);
  }

  config = parse(content) as WranglerConfig;
  const kvEntries = config.kv_namespaces?.entries() ?? [];
  for (const [index, namespace] of kvEntries) {
    if (namespace.id !== DEFAULT_HEX_ID) {
      continue;
    }
    if (!namespace.binding) {
      throw new Error(`KV namespace at index ${index} has a placeholder id but no binding.`);
    }

    const resolvedNamespace = ensureKVNamespace(config, namespace.binding);
    const namespaceName = getKVNamespaceName(config, namespace.binding);
    if (resolvedNamespace.created) {
      created.push(`kv:${namespaceName}`);
    }
    console.log(`Using KV namespace ${namespaceName}: ${resolvedNamespace.id}`);
    content = writeConfigValue(content, ['kv_namespaces', index, 'id'], resolvedNamespace.id);
  }

  config = parse(content) as WranglerConfig;
  const secretStoreIndexes = (config.secrets_store_secrets ?? [])
    .map((secret, index) => ({ secret, index }))
    .filter(({ secret }) => secret.store_id === DEFAULT_HEX_ID);
  if (secretStoreIndexes.length > 0) {
    const existed = listSecretStores().some((store) => store.name === DEFAULT_SECRET_STORE_NAME);
    const storeId = ensureSecretStore();
    if (!existed) {
      created.push(`secrets-store:${DEFAULT_SECRET_STORE_NAME}`);
    }
    console.log(`Using Secrets Store: ${storeId}`);
    for (const { index } of secretStoreIndexes) {
      content = writeConfigValue(content, ['secrets_store_secrets', index, 'store_id'], storeId);
    }
  }

  writeFileSync(CONFIG_PATH, content.endsWith('\n') ? content : `${content}\n`);

  return created;
}
