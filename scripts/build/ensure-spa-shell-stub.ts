#!/usr/bin/env node

/**
 * Writes a placeholder `apps/api/src/generated/spa-shell.ts` when it is absent.
 *
 * `pnpm install` runs this before `typegen` so the API worker typechecks in a
 * fresh clone, where the real file has not been produced by the Vite build yet.
 * Exits immediately when the file already exists, so the real build output is
 * never overwritten. The file is gitignored.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(here, '..', '..', 'apps', 'api', 'src', 'generated', 'spa-shell.ts');

if (existsSync(outPath)) process.exit(0);

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  `// Auto-generated stub — real content is produced by \`pnpm run build\` via the Vite plugin.
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
`,
);
console.log(`ensure-spa-shell-stub: created stub at ${outPath}`);
