import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const apiSrcPath = fileURLToPath(new URL('apps/api/src', import.meta.url));
const backgroundSrcPath = fileURLToPath(new URL('apps/background/src', import.meta.url));
const backendDataSrcPath = fileURLToPath(new URL('packages/backend-data/src', import.meta.url));
const backendErrorsSrcPath = fileURLToPath(new URL('packages/backend-errors/src', import.meta.url));
const backendRuntimeSrcPath = fileURLToPath(new URL('packages/backend-runtime/src', import.meta.url));
const backendServicesSrcPath = fileURLToPath(new URL('packages/backend-services/src', import.meta.url));
const providerClientsSrcPath = fileURLToPath(new URL('packages/provider-clients/src', import.meta.url));
const sharedSrcPath = fileURLToPath(new URL('packages/shared/src', import.meta.url));
const webSrcPath = fileURLToPath(new URL('apps/web/src', import.meta.url));
const cloudflareWorkersMockPath = fileURLToPath(new URL('test/mocks/cloudflare-workers.ts', import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: [
        'apps/api/src/**/*.ts',
        'apps/background/src/**/*.ts',
        // Web: services + lib only (components/hooks need jsdom +
        // @testing-library/react — documented follow-up, not silently omitted).
        'apps/web/src/services/**/*.ts',
        'apps/web/src/lib/**/*.ts',
        'packages/**/src/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/index.ts', '**/types.d.ts', '**/model/**'],
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 75,
        lines: 85,
      },
    },
  },
  resolve: {
    alias: [
      { find: /^@aws-access-bridge\/background$/, replacement: `${backgroundSrcPath}/index.ts` },
      { find: /^@aws-access-bridge\/background\/(.*)$/, replacement: `${backgroundSrcPath}/$1` },
      { find: /^@aws-access-bridge\/backend-data$/, replacement: `${backendDataSrcPath}/index.ts` },
      { find: /^@aws-access-bridge\/backend-data\/(.*)$/, replacement: `${backendDataSrcPath}/$1` },
      { find: /^@aws-access-bridge\/backend-errors$/, replacement: `${backendErrorsSrcPath}/index.ts` },
      { find: /^@aws-access-bridge\/backend-errors\/(.*)$/, replacement: `${backendErrorsSrcPath}/$1` },
      { find: /^@aws-access-bridge\/backend-runtime$/, replacement: `${backendRuntimeSrcPath}/index.ts` },
      { find: /^@aws-access-bridge\/backend-runtime\/(.*)$/, replacement: `${backendRuntimeSrcPath}/$1` },
      { find: /^@aws-access-bridge\/backend-services$/, replacement: `${backendServicesSrcPath}/index.ts` },
      { find: /^@aws-access-bridge\/backend-services\/(.*)$/, replacement: `${backendServicesSrcPath}/$1` },
      { find: /^@aws-access-bridge\/provider-clients$/, replacement: `${providerClientsSrcPath}/index.ts` },
      { find: /^@aws-access-bridge\/provider-clients\/(.*)$/, replacement: `${providerClientsSrcPath}/$1` },
      { find: /^@aws-access-bridge\/shared$/, replacement: `${sharedSrcPath}/index.ts` },
      { find: /^@aws-access-bridge\/shared\/(.*)$/, replacement: `${sharedSrcPath}/$1` },
      { find: /^@aws-access-bridge\/web\/(.*)$/, replacement: `${webSrcPath}/$1` },
      {
        find: 'hono/http-exception',
        replacement: fileURLToPath(new URL('apps/api/node_modules/hono/dist/http-exception.js', import.meta.url)),
      },
      {
        find: 'hono/utils/http-status',
        replacement: fileURLToPath(new URL('apps/api/node_modules/hono/dist/utils/http-status.js', import.meta.url)),
      },
      { find: /^hono$/, replacement: fileURLToPath(new URL('apps/api/node_modules/hono', import.meta.url)) },
      { find: 'cloudflare:workers', replacement: cloudflareWorkersMockPath },
      { find: /^@\//, replacement: `${apiSrcPath}/` },
    ],
  },
});
