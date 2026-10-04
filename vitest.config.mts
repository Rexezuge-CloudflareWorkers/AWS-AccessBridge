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
    // Two projects, because `environment` is per-project and the DOM stack cannot
    // be switched per file. `node` keeps the fast suite for the backend and for
    // web logic that needs no renderer; `jsdom` covers React hooks and
    // components. A `.tsx` file is the marker for the second one, so the split
    // is by extension rather than by directory — otherwise a component test
    // written as `.ts` would silently run in `node` and fail on `document`.
    //
    // `test/floci/**` is excluded from `node` because those tests need a running
    // emulator on 127.0.0.1:4566; they run only under `pnpm run test:floci`, from
    // their own config. Without this exclusion `pnpm test` and `pnpm run checks`
    // would pass locally and fail in CI for want of a container.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          globals: true,
          environment: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/integration/**', 'test/floci/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          globals: true,
          environment: 'jsdom',
          include: ['test/**/*.test.tsx'],
          exclude: ['test/integration/**', 'test/floci/**'],
          setupFiles: ['test/setup/dom.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: [
        'apps/api/src/**/*.ts',
        'apps/background/src/**/*.ts',
        // Web: services and lib are pure enough for the node project. Hooks and
        // components are covered by the `dom` project but stay out of this
        // umbrella: they are JSX-heavy and mostly markup, and including them
        // would move the aggregate without adding meaningful signal.
        'apps/web/src/services/**/*.ts',
        'apps/web/src/lib/**/*.ts',
        'packages/**/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        // Barrels are already excluded; also exclude the `apps/api/src/schema/*`
        // shim layer, which is pure `export *` over shared and has no executable
        // statements of its own.
        '**/index.ts',
        '**/types.d.ts',
        '**/model/**',
        'apps/api/src/schema/**',
        // Type-only modules compile to no runnable code, so v8 reports 0% and
        // they would otherwise drag the aggregate down without any behaviour
        // left to cover.
        'packages/backend-services/src/composition/ServiceEnv.ts',
        'packages/backend-services/src/composition/tokens.ts',
      ],
      // Raised as coverage improved (was 91/78/93/92, before that 90/77/89/90).
      // A threshold that is never approached stops being a signal; these sit a
      // little under the measured figures so ordinary churn does not fail the
      // build, but a real regression does.
      thresholds: {
        statements: 92,
        branches: 80,
        functions: 94,
        lines: 93,
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
