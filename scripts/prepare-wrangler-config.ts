#!/usr/bin/env tsx

import { execFileSync } from 'child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { applyEdits, modify, parse } from 'jsonc-parser';

const CONFIG_PATH = join(process.cwd(), 'wrangler.jsonc');
const TEMPLATE_PATH = join(process.cwd(), 'apps/api/wrangler.template.jsonc');
const DEFAULT_UUID = '00000000-0000-0000-0000-000000000000';
const DEFAULT_HEX_ID = '00000000000000000000000000000000';
const DEFAULT_SECRET_STORE_NAME = 'default';
const DEFAULT_KV_NAMESPACE_NAMES: Record<string, string> = {
  AccessBridgeKV: 'aws-access-bridge-kv',
};

interface WranglerConfig {
  name?: string;
  vars?: Record<string, unknown>;
  d1_databases?: Array<{
    binding?: string;
    database_id?: string;
    database_name?: string;
  }>;
  kv_namespaces?: Array<{
    binding?: string;
    id?: string;
  }>;
  secrets_store_secrets?: Array<{
    binding?: string;
    store_id?: string;
    secret_name?: string;
  }>;
}

interface D1Database {
  name?: string;
  uuid?: string;
  id?: string;
  database_id?: string;
}

interface KVNamespace {
  title?: string;
  name?: string;
  id?: string;
}

interface SecretStore {
  name: string;
  id: string;
}

function runWrangler(args: string[]): string {
  try {
    return execFileSync('pnpm', ['exec', 'wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error: unknown) {
    const maybeProcessError = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    const stdout = maybeProcessError.stdout ? maybeProcessError.stdout.toString() : '';
    const stderr = maybeProcessError.stderr ? maybeProcessError.stderr.toString() : '';
    throw new Error(`Command failed: pnpm exec wrangler ${args.join(' ')}\n${stdout}${stderr || maybeProcessError.message || ''}`);
  }
}

function readConfig(): { content: string; config: WranglerConfig } {
  const content = readFileSync(CONFIG_PATH, 'utf8');
  return { content, config: parse(content) as WranglerConfig };
}

function writeConfigValue(content: string, path: Array<string | number>, value: unknown): string {
  const edits = modify(content, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } });
  return applyEdits(content, edits);
}

function parseTopLevelPatch(): Record<string, unknown> | undefined {
  const rawPatch = process.env.WRANGLER_PATCH_JSON;
  if (!rawPatch?.trim()) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPatch) as unknown;
  } catch {
    throw new Error('WRANGLER_PATCH_JSON must be a valid JSON object.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('WRANGLER_PATCH_JSON must be a JSON object.');
  }

  return parsed as Record<string, unknown>;
}

function applyTopLevelPatch(): void {
  const patch = parseTopLevelPatch();
  const patchEntries = Object.entries(patch ?? {});
  if (patchEntries.length === 0) {
    return;
  }

  let { content } = readConfig();

  for (const [key, value] of patchEntries) {
    content = writeConfigValue(content, [key], value);
  }

  writeFileSync(CONFIG_PATH, content.endsWith('\n') ? content : `${content}\n`);
  console.log(`Applied ${patchEntries.length} Wrangler top-level patch entr${patchEntries.length === 1 ? 'y' : 'ies'}.`);
}

function parseVarsPatch(): Record<string, string> | undefined {
  const rawPatch = process.env.WRANGLER_VARS_PATCH_JSON;
  if (!rawPatch?.trim()) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPatch) as unknown;
  } catch {
    throw new Error('WRANGLER_VARS_PATCH_JSON must be a valid JSON object of string values.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('WRANGLER_VARS_PATCH_JSON must be a JSON object of string values.');
  }

  const patch: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.trim()) {
      throw new Error('WRANGLER_VARS_PATCH_JSON contains an empty variable name.');
    }
    if (typeof value !== 'string') {
      throw new Error(`WRANGLER_VARS_PATCH_JSON value for ${key} must be a string.`);
    }
    patch[key] = value;
  }

  return patch;
}

function prepareConfigFile(): void {
  const dumpedConfig = process.env.WRANGLER_JSONC;
  if (dumpedConfig?.trim()) {
    writeFileSync(CONFIG_PATH, dumpedConfig.endsWith('\n') ? dumpedConfig : `${dumpedConfig}\n`);
    console.log('Wrote wrangler.jsonc from WRANGLER_JSONC repository variable.');
    return;
  }

  copyFileSync(TEMPLATE_PATH, CONFIG_PATH);
  console.log('WRANGLER_JSONC is empty; copied apps/api/wrangler.template.jsonc to wrangler.jsonc.');
}

function ensureMinimumConfigVersion(): void {
  const template = parse(readFileSync(TEMPLATE_PATH, 'utf8')) as { $minimumVersion?: unknown };
  if (typeof template.$minimumVersion !== 'number') {
    return;
  }
  const { config } = readConfig();
  const currentVersion = (config as { $version?: unknown }).$version;
  if (typeof currentVersion !== 'number' || currentVersion < template.$minimumVersion) {
    throw new Error(
      `wrangler.jsonc version (${typeof currentVersion === 'number' ? currentVersion : 'missing'}) is below minimum template version (${template.$minimumVersion}). Regenerate it from apps/api/wrangler.template.jsonc.`,
    );
  }
}

function applyVarsPatch(): void {
  const patch = parseVarsPatch();
  const patchEntries = Object.entries(patch ?? {});
  if (patchEntries.length === 0) {
    return;
  }

  const preparedConfig = readConfig();
  let content = preparedConfig.content;
  const { config } = preparedConfig;
  if (config.vars !== undefined && (config.vars === null || typeof config.vars !== 'object' || Array.isArray(config.vars))) {
    throw new Error('wrangler.jsonc vars must be an object before applying WRANGLER_VARS_PATCH_JSON.');
  }

  if (!config.vars) {
    content = writeConfigValue(content, ['vars'], {});
  }

  for (const [key, value] of patchEntries) {
    content = writeConfigValue(content, ['vars', key], value);
  }

  writeFileSync(CONFIG_PATH, content.endsWith('\n') ? content : `${content}\n`);
  console.log(`Applied ${patchEntries.length} Wrangler vars patch entr${patchEntries.length === 1 ? 'y' : 'ies'}.`);
}

function parseJsonArray<T>(output: string, commandDescription: string): T[] {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }
  } catch {
    // Fall through to the explicit error below.
  }
  throw new Error(`Expected JSON array output from ${commandDescription}. Output:\n${output}`);
}

function getD1Id(database: D1Database): string | undefined {
  return database.uuid ?? database.database_id ?? database.id;
}

function listD1Databases(): D1Database[] {
  return parseJsonArray<D1Database>(runWrangler(['d1', 'list', '--json']), 'wrangler d1 list --json');
}

function ensureD1Database(databaseName: string): string {
  let database = listD1Databases().find((candidate) => candidate.name === databaseName);
  if (!database) {
    console.log(`Creating D1 database: ${databaseName}`);
    runWrangler(['d1', 'create', databaseName]);
    database = listD1Databases().find((candidate) => candidate.name === databaseName);
  }

  const databaseId = database ? getD1Id(database) : undefined;
  if (!databaseId) {
    throw new Error(`Unable to discover D1 database ID for ${databaseName}.`);
  }
  return databaseId;
}

function listKVNamespaces(): KVNamespace[] {
  return parseJsonArray<KVNamespace>(runWrangler(['kv', 'namespace', 'list']), 'wrangler kv namespace list');
}

function getKVNamespaceName(config: WranglerConfig, binding: string): string {
  return DEFAULT_KV_NAMESPACE_NAMES[binding] ?? `${config.name ?? 'aws-access-bridge'}-${binding.toLowerCase()}`;
}

function ensureKVNamespace(config: WranglerConfig, binding: string): string {
  const namespaceName = getKVNamespaceName(config, binding);
  const candidateNames = new Set([namespaceName, `${config.name ?? 'aws-access-bridge'}-${binding}`, binding]);
  let namespace = listKVNamespaces().find((candidate) => {
    const candidateName = candidate.title ?? candidate.name;
    return candidate.id && candidateName && candidateNames.has(candidateName);
  });
  if (!namespace) {
    console.log(`Creating KV namespace: ${namespaceName}`);
    runWrangler(['kv', 'namespace', 'create', namespaceName]);
    namespace = listKVNamespaces().find((candidate) => candidate.id && (candidate.title ?? candidate.name) === namespaceName);
  }

  if (!namespace?.id) {
    throw new Error(`Unable to discover KV namespace ID for ${namespaceName}.`);
  }
  return namespace.id;
}

function parseSecretStoresTable(output: string): SecretStore[] {
  const stores: SecretStore[] = [];
  for (const line of output.split('\n')) {
    if (!line.includes('│')) {
      continue;
    }

    const cells = line
      .split('│')
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length < 2 || cells[0] === 'Name' || cells[0].includes('─')) {
      continue;
    }

    const [name, id] = cells;
    if (/^[a-f0-9]{32}$/i.test(id)) {
      stores.push({ name, id });
    }
  }
  return stores;
}

function listSecretStores(): SecretStore[] {
  const output = runWrangler(['secrets-store', 'store', 'list', '--remote']);
  try {
    return parseJsonArray<SecretStore>(output, 'wrangler secrets-store store list --remote');
  } catch {
    return parseSecretStoresTable(output);
  }
}

function ensureSecretStore(): string {
  let stores = listSecretStores();
  if (stores.length > 0) {
    const store = stores.find((candidate) => candidate.name === DEFAULT_SECRET_STORE_NAME) ?? stores[0];
    return store.id;
  }

  console.log(`Creating Secrets Store: ${DEFAULT_SECRET_STORE_NAME}`);
  const output = runWrangler(['secrets-store', 'store', 'create', DEFAULT_SECRET_STORE_NAME, '--remote']);
  const createdStoreId = output.match(/ID:\s*([a-f0-9]{32})/i)?.[1];
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

function provisionWranglerResources(): void {
  let { content, config } = readConfig();

  for (const [index, database] of config.d1_databases?.entries() ?? []) {
    if (database.database_id !== DEFAULT_UUID) {
      continue;
    }
    if (!database.database_name) {
      throw new Error(`D1 database binding ${database.binding ?? index} has a placeholder database_id but no database_name.`);
    }

    const databaseId = ensureD1Database(database.database_name);
    console.log(`Using D1 database ${database.database_name}: ${databaseId}`);
    content = writeConfigValue(content, ['d1_databases', index, 'database_id'], databaseId);
  }

  config = parse(content) as WranglerConfig;
  for (const [index, namespace] of config.kv_namespaces?.entries() ?? []) {
    if (namespace.id !== DEFAULT_HEX_ID) {
      continue;
    }
    if (!namespace.binding) {
      throw new Error(`KV namespace at index ${index} has a placeholder id but no binding.`);
    }

    const namespaceId = ensureKVNamespace(config, namespace.binding);
    console.log(`Using KV namespace ${getKVNamespaceName(config, namespace.binding)}: ${namespaceId}`);
    content = writeConfigValue(content, ['kv_namespaces', index, 'id'], namespaceId);
  }

  config = parse(content) as WranglerConfig;
  const secretStoreIndexes = (config.secrets_store_secrets ?? [])
    .map((secret, index) => ({ secret, index }))
    .filter(({ secret }) => secret.store_id === DEFAULT_HEX_ID);
  if (secretStoreIndexes.length > 0) {
    const storeId = ensureSecretStore();
    console.log(`Using Secrets Store: ${storeId}`);
    for (const { index } of secretStoreIndexes) {
      content = writeConfigValue(content, ['secrets_store_secrets', index, 'store_id'], storeId);
    }
  }

  writeFileSync(CONFIG_PATH, content.endsWith('\n') ? content : `${content}\n`);
}

prepareConfigFile();
ensureMinimumConfigVersion();
applyTopLevelPatch();
applyVarsPatch();
provisionWranglerResources();
console.log('Wrangler configuration is ready.');
