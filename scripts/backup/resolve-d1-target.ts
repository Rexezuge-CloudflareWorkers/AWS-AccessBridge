#!/usr/bin/env tsx

/**
 * Resolves which D1 database the backup workflow should export.
 *
 * Runs after `prepare-wrangler-config.ts` has materialized `wrangler.jsonc`, so
 * the database resolved here is exactly the one the deploy targets — no
 * separate `D1_DATABASE_ID` secret to keep in sync.
 *
 * Guards two failure modes:
 *   1. No `d1_databases` entry at all — nothing to export.
 *   2. A placeholder `database_id` — `prepare-wrangler-config.ts` auto-provisions
 *      a missing D1 database, and a database it just created holds no user data.
 *      Uploading that empty dump would be a false sense of safety.
 *
 * Emits the export target as the `target` step output.
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'jsonc-parser';

import { fail, setOutput } from './github-output';

const CONFIG_PATH = join(process.cwd(), 'wrangler.jsonc');

/** The id every placeholder in `apps/api/wrangler.template.jsonc` carries. */
export const PLACEHOLDER_DATABASE_ID = '00000000-0000-0000-0000-000000000000';

export interface D1DatabaseBinding {
  binding?: string;
  database_id?: string;
  database_name?: string;
}

export interface D1Target {
  /** The binding name, used for log output and as the export fallback. */
  binding: string;
  /** The database id, verified against Cloudflare by the caller. */
  databaseId: string;
  /** What `wrangler d1 export` should be pointed at. */
  target: string;
}

/**
 * Pick the export target from a parsed wrangler config.
 *
 * `wrangler d1 export` takes a database *name*, so `database_name` wins when
 * present. Hand-written configs that omit it fall back to the binding name.
 *
 * @throws when there is no binding, or when `database_id` is still the template
 *   placeholder (meaning the database was auto-provisioned and holds no data).
 */
export function resolveD1Target(config: { d1_databases?: D1DatabaseBinding[] }): D1Target {
  const database = config.d1_databases?.[0];

  const binding = database?.binding?.trim();
  if (!binding) {
    throw new Error('No d1_databases entry with a binding found in wrangler.jsonc.');
  }

  const databaseId = database?.database_id?.trim() ?? '';
  if (databaseId === PLACEHOLDER_DATABASE_ID) {
    throw new Error(
      `D1 database_id for ${binding} is still the template placeholder. The database does not exist yet, so there is nothing to back up.`,
    );
  }

  const target = database?.database_name?.trim() || binding;
  return { binding, databaseId, target };
}

const isMain = process.argv[1]?.endsWith('resolve-d1-target.ts') ?? false;
if (isMain) {
  // wrangler.jsonc keeps `//` comments and trailing commas, so it needs the jsonc
  // parser rather than JSON.parse. Same approach as prepare-wrangler-config.ts.
  let config: { d1_databases?: D1DatabaseBinding[] };
  try {
    config = parse(readFileSync(CONFIG_PATH, 'utf8')) as { d1_databases?: D1DatabaseBinding[] };
  } catch {
    fail(`Could not read ${CONFIG_PATH}. This step must run after scripts/prepare-wrangler-config.ts.`);
  }

  let target: D1Target;
  try {
    target = resolveD1Target(config);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  console.log(`D1 binding: ${target.binding}`);
  console.log(`Exporting D1 database: ${target.target} (${target.databaseId})`);

  // Fail here rather than mid-export if the database is unreachable or absent.
  try {
    execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'info', target.target, '--remote', '--config', CONFIG_PATH, '--json'], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  } catch {
    fail(`Unable to read D1 database "${target.target}" with the configured credentials.`);
  }

  setOutput('target', target.target);
}
