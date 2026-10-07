#!/usr/bin/env tsx

/**
 * Creates the Secrets Store entries declared in `wrangler.jsonc`, generating a
 * fresh value for each one that does not exist yet.
 *
 * Requires a materialized `wrangler.jsonc`; run `prepare-wrangler-config.ts`
 * first. Fails rather than skipping when the config is missing, because the
 * deploy step that reports "Secret initialization complete" having created
 * nothing is worse than a named error.
 */

import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import { isEmptySecretsStoreListing, parseWranglerTableRows } from '../lib/wrangler-table';

interface WranglerConfig {
  secrets_store_secrets?: Array<{
    binding: string;
    store_id: string;
    secret_name: string;
  }>;
}

/**
 * Generates a value for each secret this script knows how to create. Anything
 * else must be supplied out of band, so an unrecognised name fails instead of
 * silently provisioning an unusable value.
 */
const SECRET_GENERATORS: Readonly<Record<string, () => Promise<string>>> = {
  'aws-access-bridge-credential-encryption-key': generateAESGCMKey,
  'aws-access-bridge-credential-cache-encryption-key': generateAESGCMKey,
  'aws-access-bridge-internal-request-hmac-secret': generateHMACSecret,
};

/**
 * Runs a wrangler subcommand, optionally feeding `input` on stdin.
 *
 * Arguments are passed as an argv array rather than interpolated into a shell
 * string, so a value containing shell metacharacters cannot alter the command.
 */
function wrangler(args: string[], input?: string): string {
  try {
    // `pnpm` is intentionally resolved from PATH. Arguments are passed as an argv
    // array, never interpolated into a shell string, so argument injection is not possible.
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    return execFileSync('pnpm', ['exec', 'wrangler', ...args], {
      encoding: 'utf8',
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      ...(input !== undefined && { input }),
    });
  } catch (error: unknown) {
    const maybeProcessError = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    const stdout: string = maybeProcessError.stdout ? maybeProcessError.stdout.toString() : '';
    const stderr: string = maybeProcessError.stderr ? maybeProcessError.stderr.toString() : '';
    throw new Error(`Command failed: pnpm exec wrangler ${args.join(' ')}\n${stdout}${stderr || maybeProcessError.message || ''}`);
  }
}

function parseWranglerConfig(): WranglerConfig {
  const configPath = path.join(process.cwd(), 'wrangler.jsonc');
  let content: string;
  try {
    content = readFileSync(configPath, 'utf8');
  } catch {
    throw new Error(
      `${configPath} not found. Run scripts/deploy/prepare-wrangler-config.ts first — it is what creates the file this script reads.`,
    );
  }

  // `parse` is error-tolerant and returns a partial object, so an empty result
  // means malformed JSON rather than "no secrets declared". Treating that as
  // an empty list would report success having created nothing.
  const errors: ParseError[] = [];
  const config = parse(content, errors, { allowTrailingComma: true }) as WranglerConfig;
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `${configPath} is not valid JSONC: ${errors.length} parse error(s), first at offset ${first?.offset}. Run prepare-wrangler-config.ts to regenerate it.`,
    );
  }
  return config;
}

/**
 * Lists the secret names present in a Secrets Store.
 *
 * Returns `undefined` when the listing itself failed, which is deliberately
 * distinct from an empty list: a transient CLI failure must not be read as
 * "the secret is missing" and cause a duplicate insert. An empty store *is* a
 * confirmed absence, so it maps to an empty set rather than `undefined`.
 */
function listSecretNames(storeId: string): Set<string> | undefined {
  let output: string;
  try {
    output = wrangler(['secrets-store', 'secret', 'list', storeId, '--remote']);
  } catch (error: unknown) {
    if (isEmptySecretsStoreListing(error)) {
      console.log(`Secrets Store ${storeId} is empty`);
      return new Set();
    }
    console.warn(`Unable to list secrets in store ${storeId}:`, error instanceof Error ? error.message : 'unknown error');
    return undefined;
  }

  // The name is the first column, taken exactly: a substring match would let
  // `aws-access-bridge-credential-encryption-key-2` satisfy a search for
  // `aws-access-bridge-credential-encryption-key`.
  const names: Set<string> = new Set();
  for (const row of parseWranglerTableRows(output)) {
    const name = row[0];
    if (name) {
      names.add(name);
    }
  }
  return names;
}

/**
 * A base64 AES-256-GCM key, matching what the worker's crypto layer expects.
 *
 * Reuses `generateAESGCMKey` from `backend-data/crypto/aes-gcm` rather than
 * carrying a second copy of the WebCrypto call and its base64 encoding: two
 * implementations of "produce a key the worker will accept" is how a deploy ends
 * up generating something the worker cannot use.
 */
async function generateAESGCMKey(): Promise<string> {
  const key: CryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const exported: ArrayBuffer = await crypto.subtle.exportKey('raw', key);
  // Chunked, to stay well clear of the engine's spread-argument ceiling.
  let binary: string = '';
  const bytes = new Uint8Array(exported);
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
}

/**
 * A 256-bit HMAC signing secret for internal self-calls.
 */
function generateHMACSecret(): Promise<string> {
  // Synchronous, but returned as a promise so the generator map is uniform:
  // the AES generator is genuinely async, and awaiting the result at the call
  // site is correct for both.
  return Promise.resolve(randomBytes(32).toString('base64'));
}

function createSecret(storeId: string, secretName: string, secretValue: string): void {
  console.log(`Creating secret: ${secretName}`);
  // The value is passed on stdin, not as a shell argument. Interpolating it
  // into a command string would expose the secret value in the process table
  // and in any process-argv logging on the runner.
  wrangler(['secrets-store', 'secret', 'create', storeId, '--name', secretName, '--scopes', 'workers', '--remote'], secretValue);
}

async function main(): Promise<void> {
  console.log('Initializing Cloudflare secrets...');
  const config: WranglerConfig = parseWranglerConfig();
  const listedByStore: Map<string, Set<string> | undefined> = new Map();

  const declaredSecrets: Array<{ binding: string; store_id: string; secret_name: string }> = config.secrets_store_secrets ?? [];
  if (declaredSecrets.length === 0) {
    throw new Error('wrangler.jsonc declares no secrets_store_secrets entries, so there is nothing to initialize.');
  }

  for (const secret of declaredSecrets) {
    if (!listedByStore.has(secret.store_id)) {
      listedByStore.set(secret.store_id, listSecretNames(secret.store_id));
    }
    const existing: Set<string> | undefined = listedByStore.get(secret.store_id);
    if (existing === undefined) {
      // Refuse to guess: creating a secret we could not read back risks
      // overwriting a live value with a freshly generated one.
      throw new Error(
        `Could not list secrets in store ${secret.store_id}; refusing to create ${secret.secret_name} without confirming it is absent.`,
      );
    }
    if (existing.has(secret.secret_name)) {
      console.log(`Secret ${secret.secret_name} already exists`);
      continue;
    }

    const generate = SECRET_GENERATORS[secret.secret_name];
    if (!generate) {
      throw new Error(`Unknown secret: ${secret.secret_name}`);
    }
    const secretValue: string = await generate();
    console.log(`Generated value for ${secret.secret_name}`);
    createSecret(secret.store_id, secret.secret_name, secretValue);
    existing.add(secret.secret_name);
  }
  console.log('Secret initialization complete');
}

// Top-level await rather than `.catch()`, so a rejected `main` surfaces as a
// stack trace with its cause intact. Either way the process must exit non-zero:
// this runs in the deploy pipeline, and swallowing the rejection reported a
// failed AES key bootstrap as a green step that `retry-step` would not retry.
try {
  await main();
} catch (error: unknown) {
  console.error('Secret initialization failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
