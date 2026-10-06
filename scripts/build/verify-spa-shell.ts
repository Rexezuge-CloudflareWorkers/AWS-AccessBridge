#!/usr/bin/env tsx

/**
 * Fail when the SPA shell the API worker serves is missing or self-inconsistent.
 *
 * `AccessBridgeWorker` answers browser navigations with `SPA_HTML`, embedded from
 * `apps/web/dist/index.html` by the Vite `spa-shell-embed` plugin. Both that file and
 * `apps/web/dist/` are gitignored build artifacts, and `postinstall` writes a stub so
 * the worker typechecks in a fresh clone — so a clone that never ran `pnpm run build`
 * deploys a page that renders its static markup and loads no JavaScript, with nothing
 * in the source tree saying so.
 *
 * The stub this repository writes is a **complete, plausible-looking HTML page**, not
 * an empty string. That is what makes `no-assets` the check that catches it: it clears
 * every other test here, so a size or parse check would pass it.
 *
 * What this catches:
 * - the `postinstall` stub (or no build at all) still in place;
 * - `spa-shell.ts` referencing `/assets/...` bundles that were not emitted (a
 *   partially cleaned or half-copied `dist/`, which serves a shell whose JS 404s
 *   and therefore renders no operator UI at all);
 * - `spa-shell.ts` and `apps/web/dist/index.html` disagreeing, i.e. only one of the
 *   two halves of the build was refreshed.
 *
 * Known limit, deliberately stated rather than papered over: this cannot detect a
 * *stale but self-consistent* pair. A `dist/` and a `spa-shell.ts` built together
 * from last week's source agree with each other, and that class is exactly the one this
 * cannot see. The remaining duty is therefore operational: run `pnpm run build` after
 * touching `apps/web`, before `wrangler deploy`.
 *
 * **The build is a precondition of this check, not a convenience.** Both paths below
 * are gitignored and `postinstall` writes a stub, so verifying without building cannot
 * pass — and it fails with precisely the message below, which is the check working
 * rather than the check being wrong.
 *
 * The rules live in `spa-shell-checks.ts` so they are unit tested; this entrypoint
 * only does I/O and reporting. `tsx` rather than `node` because of the extensionless
 * sibling import, as every other entrypoint here is.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkShell } from './spa-shell-checks';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHELL_PATH = path.join(ROOT, 'apps/api/src/generated/spa-shell.ts');
const DIST_INDEX = path.join(ROOT, 'apps/web/dist/index.html');
const DIST_ASSETS = path.join(ROOT, 'apps/web/dist/assets');

function readIfPresent(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

const problems = checkShell(readIfPresent(SHELL_PATH), readIfPresent(DIST_INDEX), (asset) => existsSync(path.join(DIST_ASSETS, asset)));

if (problems.length > 0) {
  console.error('SPA shell check failed:');
  for (const problem of problems) console.error(`  - [${problem.code}] ${problem.detail}`);
  process.exit(1);
}
console.log('SPA shell check passed (apps/api/src/generated/spa-shell.ts matches apps/web/dist).');
