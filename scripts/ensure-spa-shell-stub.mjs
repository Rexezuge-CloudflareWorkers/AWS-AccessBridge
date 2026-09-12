#!/usr/bin/env node
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '..', 'apps/api/src/generated/spa-shell.ts');

if (existsSync(outPath)) process.exit(0);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  '// Auto-generated stub — real content is produced by `pnpm run build` via the Vite plugin.\n' +
    'export const SPA_HTML: string = `<!doctype html>\\n' +
    '<html lang="en">\\n' +
    '  <head>\\n' +
    '    <meta charset="UTF-8" />\\n' +
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\\n' +
    '    <title>AWS AccessBridge</title>\\n' +
    '  </head>\\n' +
    '  <body>\\n' +
    '    <div id="root">AWS AccessBridge</div>\\n' +
    '  </body>\\n' +
    '</html>`;\n',
);
console.log(`ensure-spa-shell-stub: created stub at ${outPath}`);
