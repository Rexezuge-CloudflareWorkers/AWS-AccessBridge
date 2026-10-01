#!/usr/bin/env tsx

/**
 * Verify `migrations/*.sql` against `migrations/migrations.lock.json`.
 *
 * D1 records which migrations it applied but not what they contained, so editing
 * an already-applied migration is invisible to every existing tool: the deploy
 * succeeds, fresh databases get the edited statements, and production keeps the
 * schema it had. This script turns that into a CI failure.
 *
 * Run with `pnpm run validate:migrations`.
 *
 * Usage:
 *   pnpm run validate:migrations              verify only; changes nothing
 *   pnpm exec tsx scripts/migrations/verify-migrations.ts --write
 *
 * `--write` adds an entry per unlocked file, refreshes the baseline, and drops
 * entries the baseline has absorbed. It never touches another existing entry, so
 * an incremental migration that has drifted still fails after a `--write`;
 * re-baselining one means deleting its entry by hand, which shows up in the diff.
 * The lock is then re-checked, so a `--write` that fixed everything exits 0 and
 * one that did not still exits 1.
 *
 * TypeScript rather than `.mjs` so the script is covered by the repo's lint and
 * typecheck rules; the rules themselves live in `lock-check.ts` so they are unit
 * tested. Run through `tsx` rather than `node` because of the extensionless
 * relative import, as every other script that imports a sibling module does.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFlags, isSet } from '../lib/cli-args';
import { checkMigrations, DIGEST_PREFIX, parseLock, type CheckResult, type MigrationFile } from './lock-check';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const LOCK_PATH = path.join(MIGRATIONS_DIR, 'migrations.lock.json');

const flags = parseFlags(process.argv.slice(2), { boolean: ['write'] });
const write = isSet(flags, 'write');

/**
 * Every migration on disk, in the order D1 would apply them.
 *
 * Top level only, matching wrangler's default `${migrationsDir}/*.sql` pattern,
 * so the lock describes exactly the set wrangler will run — and
 * `migrations.lock.json` is not one of them, because it is not a `.sql` file.
 */
const files: MigrationFile[] = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .toSorted((left, right) => left.localeCompare(right))
  .map((name) => ({
    name,
    digest: `${DIGEST_PREFIX}${createHash('sha256')
      .update(readFileSync(path.join(MIGRATIONS_DIR, name)))
      .digest('hex')}`,
  }));

/**
 * The lock's current text, or `null` when it does not exist. `null` rather than
 * an empty string so the reason reported is "the lock does not exist" and not
 * "the lock is not valid JSON".
 */
function readLock(): string | null {
  try {
    return readFileSync(LOCK_PATH, 'utf8');
  } catch {
    return null;
  }
}

function check(raw: string | null): CheckResult {
  const { lock, findings } = parseLock(raw);
  return checkMigrations(files, lock, findings);
}

const result = check(readLock());

for (const file of files) {
  const status = result.findings.some((finding) => finding.subject === file.name) ? 'CHANGED' : 'OK';
  console.log(`${file.name}: ${file.digest} [${status}]`);
}

// `JSON.stringify(…, null, 2)` plus a newline is a Prettier fixed point for this
// shape, so a rewrite cannot create a formatting diff for `pnpm run prettier` to
// fix. Comparing the whole document rather than the set of added entries is what
// makes `--write` idempotent and lets it create an absent lock through the same
// path.
if (write && result.updated !== null) {
  const next = `${JSON.stringify(result.updated, null, 2)}\n`;
  if (next !== readLock()) {
    const { lock } = parseLock(readLock());
    const before = lock?.migrations ?? {};
    const after = result.updated.migrations;
    const added = Object.keys(after).filter((name) => before[name] === undefined);
    const refreshed = Object.keys(after).filter((name) => before[name] !== undefined && before[name] !== after[name]);
    const dropped = Object.keys(before).filter((name) => after[name] === undefined);

    writeFileSync(LOCK_PATH, next);
    console.log('\nwrote migrations/migrations.lock.json');
    for (const name of added) {
      console.log(`  + ${name}: ${after[name]}`);
    }
    for (const name of refreshed) {
      console.log(`  ~ ${name}: ${before[name]} -> ${after[name]}`);
    }
    for (const name of dropped) {
      console.log(`  - ${name} (squashed into ${result.updated.baseline ?? 'the baseline'})`);
    }
  }
}

// Re-checked against the lock as it now reads, so a `--write` that resolved
// everything exits 0 and one that could not still exits 1. Reporting the
// pre-write findings would call a successful bootstrap a failure.
const final = write ? check(readLock()) : result;

if (final.findings.length > 0) {
  console.error('');
  for (const finding of final.findings) {
    console.error(`FAIL: ${finding.subject === '' ? 'migrations/migrations.lock.json' : finding.subject} ${finding.detail}`);
  }
  console.error(`\n${final.findings.length} failure(s)`);
  process.exit(1);
}

console.log(`\nALL OK — ${files.length} migration(s) match the lock`);
