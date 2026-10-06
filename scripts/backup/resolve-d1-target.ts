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
 *   2. A database that was **created by the provisioning step in this same run** — it
 *      holds no user data, and uploading that empty dump would be a false sense of
 *      safety.
 *
 * The second guard reads `PROVISIONED_RESOURCES`, which the previous step emits, and it
 * has to. This used to re-read the placeholder `database_id` out of `wrangler.jsonc`,
 * which is **unreachable**: the same job runs `prepare-wrangler-config.ts` first, and
 * `provisionWranglerResources` patches the placeholder away before the reader runs, so
 * no `database_id` can still equal it. The guard could not fire for the one case it was
 * written for, and a check that cannot fail is indistinguishable from the absence of
 * data. `resolveD1Target` still rejects a placeholder as a second line of defence — it
 * just is not the one doing the work.
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

// Emitted by the provisioning step. A `d1:` entry means this run created the
// database, so there is nothing in it to back up.
const provisioned = (process.env['PROVISIONED_RESOURCES'] ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
if (provisioned.some((entry) => entry.startsWith('d1:'))) {
  fail(
    `${target.target} was created by the provisioning step in this same run, so it holds no data. Refusing to upload an empty dump as a backup. Provision it with a deploy first.`,
  );
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
