import { defineConfig } from 'vitest/config';
import { cloudflareTest, cloudflarePool } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const apiSrcPath = fileURLToPath(new URL('../../apps/api/src', import.meta.url));
const backgroundSrcPath = fileURLToPath(new URL('../../apps/background/src', import.meta.url));
const backendCoreSrcPath = fileURLToPath(new URL('../../packages/backend-core/src', import.meta.url));
const sharedSrcPath = fileURLToPath(new URL('../../packages/shared/src', import.meta.url));

const migrationsDir = resolve(fileURLToPath(new URL('../../migrations', import.meta.url)));
const migrationFiles = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
const migrationSql = migrationFiles.map(f => readFileSync(resolve(migrationsDir, f), 'utf-8')).join('\n\n');

export default defineConfig({
  define: {
    __INTEGRATION_MIGRATION_SQL__: JSON.stringify(migrationSql),
  },
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './test/integration/wrangler.test.jsonc',
      },
    }),
  ],
  test: {
    globals: true,
    include: ['test/integration/**/*.int.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage-integration',
      include: [
        'apps/api/src/**/*.ts',
        'apps/background/src/**/*.ts',
        'packages/**/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.int.test.ts',
        '**/*.d.ts',
        '**/index.ts',
        '**/types.d.ts',
      ],
    },
    pool: cloudflarePool({
      wrangler: {
        configPath: './test/integration/wrangler.test.jsonc',
      },
    }),
  },
  ssr: {
    noExternal: [
      'hono',
      '@aws-access-bridge',
    ],
  },
  resolve: {
    alias: [
      { find: '@aws-access-bridge/background', replacement: backgroundSrcPath },
      { find: '@aws-access-bridge/backend-core', replacement: backendCoreSrcPath },
      { find: '@aws-access-bridge/shared', replacement: sharedSrcPath },
      { find: /^@\//, replacement: `${apiSrcPath}/` },
    ],
  },
});
