#!/usr/bin/env node
/**
 * Fail CI when source files grow back into god-files.
 *
 * Rationale: a file past a few hundred lines stops being readable as a unit. The
 * failure modes are not hypothetical — this repo's own history has a 219-line
 * god-class and a 495-line React component, both of which had to be split by hand.
 * A cheap gate turns that from a discovery into a review prompt.
 *
 * Excludes: node_modules, dist, locales, generated, tests, migrations, lockfiles.
 * Soft limit 300 LOC (warn), hard limit 400 LOC (error).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SOFT = 300;
const HARD = 400;
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.wrangler', 'coverage', 'coverage-integration', '.git']);
// `.tsx` variants matter: the walker collects both, so a list that only named
// `.test.ts` let every React test file through the guard and reported them as
// god files. The suffix set is built from the extensions rather than enumerated,
// so a new test extension cannot silently escape.
const TEST_SUFFIX = ['test', 'spec'];
const EXCLUDE_SUFFIX = [
  ...TEST_SUFFIX.flatMap((kind) => ['.ts', '.tsx', '.js', '.jsx', '.mjs'].map((ext) => `.${kind}${ext}`)),
  '.d.ts',
];

/**
Paths relative to ROOT, so the patterns below can match on directory too.

Every directory pattern is anchored with `(?:^|/)` rather than a bare leading `/`.
`relative()` yields `test/helpers/x.ts` for this repository's top-level test directory
and `scripts/lib/x.ts` for the scripts directory — **no leading separator** — so a
pattern written as `/\/(?:test|tests|__tests__)\//` never matches either one. It looks
right, it does match when handed an absolute path, and against these two directories
it is silently a no-op. The `scripts` pattern carries the anchor; the test-directory
pattern did not, so the exclusion was dead for the exact layout it was written for.

It is latent here rather than active — no `test/` file is currently over the limit, so
the guard reports the same either way. Fixing it *removes* `test/` from the guard, which
is the intent: a double modelling the platform grows with the platform's surface, not
with the complexity of the code it stands in for.
*/
function shouldSkip(rel) {
  const path = rel;
  if (
    /(?:^|\/)(?:locales|generated)\//.test(path) ||
    // `__tests__`/`__mocks__` can be the last segment of a path too, so matched as
    // whole segments rather than requiring something after the slash.
    /(?:^|\/)__(?:tests|mocks)__(?:\/|$)/.test(path)
  )
    return true;
  // Tooling is not product source: build/lint/test configs and scripts grow
  // with project surface, not complexity. Guard only product + test code.
  // Matched on a path segment rather than `/scripts/` because `relative()` yields
  // `scripts/...` with no leading separator for a top-level directory.
  if (/(?:^|\/)scripts\//.test(path)) return true;
  if (
    /\.config\.(?:m?[jt]s|cjs)$/.test(path) ||
    path.endsWith('.json') ||
    path.endsWith('.sql') ||
    path.endsWith('.md') ||
    // Directory-based test roots, for files not named `*.test.ts`. This is the
    // pattern that was previously unanchored, and so never fired.
    /(?:^|\/)(?:test|tests|__tests__)\//.test(path) ||
    EXCLUDE_SUFFIX.some((s) => path.endsWith(s))
  )
    return true;
  return false;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      // A dangling symlink or a file removed mid-walk is not a god-file problem.
      continue;
    }
    if (stat.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry)) continue;
      walk(full, out);
    } else if (/\.(?:ts|tsx|js|mjs|cjs|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(ROOT).filter((f) => !shouldSkip(path.relative(ROOT, f)));
let failed = false;
const over = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n').length;
  if (lines > HARD) {
    failed = true;
    over.push({ file: path.relative(ROOT, file), lines, level: 'ERROR' });
  } else if (lines > SOFT) {
    over.push({ file: path.relative(ROOT, file), lines, level: 'WARN' });
  }
}
over.sort((a, b) => b.lines - a.lines);
for (const o of over.slice(0, 30)) console.log(`${o.level} ${o.lines} ${o.file}`);
if (failed) {
  console.error(`\nGod-file check failed: ${over.filter((o) => o.level === 'ERROR').length} file(s) exceed ${HARD} LOC. Split them.`);
  process.exit(1);
}
console.log(`\nGod-file check passed (${files.length} files, ${over.length} over soft limit ${SOFT}).`);