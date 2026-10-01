#!/usr/bin/env tsx

/**
 * Resolves which D1 database the backup workflow should export.
 *
 * Runs after `scripts/deploy/prepare-wrangler-config.ts` has materialized
 * `wrangler.jsonc`, so the database resolved here is exactly the one the deploy
 * targets — no separate `D1_DATABASE_ID` secret to keep in sync.
 *
 * Guards two failure modes:
 *   1. No `d1_databases` entry at all — nothing to export.
 *   2. A placeholder `database_id` — `prepare-wrangler-config.ts` auto-provisions
 *      a missing D1 database, and a database it just created holds no user data.
 *      Uploading that empty dump would be a false sense of safety.
 *
 * Emits the export target as the `target` step output.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'jsonc-parser';
import { fail, setOutput } from '../lib/github-actions';
import { CONFIG_PATH } from '../lib/wrangler-config/types';
import { resolveD1Target, type D1DatabaseBinding, type D1Target } from './d1-target';

// wrangler.jsonc keeps `//` comments and trailing commas, so it needs the jsonc
// parser rather than JSON.parse. Same approach as prepare-wrangler-config.ts.
let config: { d1_databases?: D1DatabaseBinding[] };
try {
  config = parse(readFileSync(CONFIG_PATH, 'utf8')) as { d1_databases?: D1DatabaseBinding[] };
} catch {
  fail(`Could not read ${CONFIG_PATH}. This step must run after scripts/deploy/prepare-wrangler-config.ts.`);
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
// `d1 info` has no --remote flag: it always acts on the remote database, and
// passing the flag makes wrangler exit non-zero on an unknown argument.
try {
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'info', target.target, '--config', CONFIG_PATH, '--json'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
} catch {
  fail(`Unable to read D1 database "${target.target}" with the configured credentials.`);
}

setOutput('target', target.target);
