#!/usr/bin/env node

/**
 * Writes a placeholder `apps/api/src/generated/spa-shell.ts` when it is absent.
 *
 * `pnpm install` runs this before `typegen` so the API worker typechecks in a
 * fresh clone, where the real file has not been produced by the Vite build yet.
 * The create is exclusive, so the real build output is never overwritten. The
 * file is gitignored.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(here, '..', '..', 'apps', 'api', 'src', 'generated', 'spa-shell.ts');

const stub = `// Auto-generated stub — real content is produced by \`pnpm run build\` via the Vite plugin.
export const SPA_HTML: string = \`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AWS AccessBridge</title>
  </head>
  <body>
    <div id="root">AWS AccessBridge</div>
  </body>
</html>\`;
`;

mkdirSync(path.dirname(outPath), { recursive: true });

try {
  // `wx` is O_CREAT | O_EXCL, so the create itself is the existence check:
  // the real build output makes it fail with `EEXIST` rather than being
  // overwritten, which `existsSync` followed by a plain write could not ensure.
  writeFileSync(outPath, stub, { flag: 'wx' });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST') process.exit(0);
  throw error;
}

console.log(`ensure-spa-shell-stub: created stub at ${outPath}`);
