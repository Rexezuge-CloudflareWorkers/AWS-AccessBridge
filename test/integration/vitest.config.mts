import { defineIntegrationVitestConfig } from '@rexezuge/tooling/vitest-integration';
import { cloudflareTest, cloudflarePool } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const migrationsDir = path.resolve(fileURLToPath(new URL('../../migrations', import.meta.url)));
const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .toSorted((left, right) => left.localeCompare(right));
const migrationEntries = migrationFiles.map((f) => ({ name: f, sql: readFileSync(path.resolve(migrationsDir, f), 'utf8') }));
// Both forms are injected: the per-file list so a test can apply a named range
// (the 0032 upgrade test seeds between migrations), and the flattened string
// kept for harnesses/tests that only want the whole bundle.
const migrationSql = migrationEntries.map((f) => f.sql).join('\n\n');

/**
 * The workerd integration suite, on the kit's factory.
 *
 * The factory generates the `@aws-access-bridge/* → src` table from `scope`, so
 * this table cannot drift from the unit suite's — a suite resolving a workspace
 * import differently from its sibling fails in a way that looks like a product
 * bug. The `plugins`, `pool` and `define` blocks below are harness wiring the
 * factory passes through untouched, by design: importing the workerd plugin into
 * the tooling package would make it undownloadable for a consumer without one.
 */
export default defineIntegrationVitestConfig({
  scope: '@aws-access-bridge',
  root: new URL('../../', import.meta.url).href,
  packages: ['shared', 'backend-runtime', 'backend-data', 'backend-services', 'provider-clients'],
  include: ['test/integration/**/*.int.test.ts'],
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './test/integration/wrangler.test.jsonc',
      },
    }),
  ],
  pool: cloudflarePool({
    wrangler: {
      configPath: './test/integration/wrangler.test.jsonc',
    },
  }),
  // Not a factory option: the harness injects the migration bundle as a compile
  // time constant, which is what lets a test apply a *named range* rather than
  // the whole set.
  define: {
    __INTEGRATION_MIGRATION_SQL__: JSON.stringify(migrationSql),
    __INTEGRATION_MIGRATION_FILES__: JSON.stringify(migrationEntries),
  },
  // `hono` and `chanfana` are peers of every kit package rather than
  // dependencies, so a `link:` install can hand two copies to Node: the kit's for
  // its own imports, the app's for the app's. Two `hono` means two
  // `HTTPException` identities and a `toErrorResponse` that does not recognise
  // what a route threw. The kit's own `dist/` is kept in the pipeline for the
  // same reason the unit config inlines it.
  aliases: [
    {
      find: '@aws-access-bridge/web',
      replacement: fileURLToPath(new URL('../../apps/web/src', import.meta.url)),
    },
  ],
  ssrNoExternal: ['hono', 'chanfana', '@aws-access-bridge'],
});
