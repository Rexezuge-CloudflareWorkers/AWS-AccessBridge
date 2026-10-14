import { defineRepoVitestConfig } from '@rexezuge/tooling/vitest-repo';
import { fileURLToPath } from 'node:url';

/**
 * The unit suite, on the kit's single-file `projects` factory.
 *
 * This replaced 162 lines that spelled out what the factory derives: the
 * workspace alias table for the five packages this repo actually has, the
 * `cloudflare:workers` mock, the `hono` dedupe, and the `node`/`dom` split by
 * file extension. The reasoning for those choices was not lost — it lives here,
 * in the places where this repo's answer differs from the factory's default.
 */
export default defineRepoVitestConfig({
  scope: '@aws-access-bridge',
  root: new URL('.', import.meta.url).href,

  /**
   * The five packages under `packages/`. The factory's default is the union
   * across all nine consumer repos, so an explicit list is what keeps this repo's
   * table to its own scope — an alias for `dav-store` here would never match, but
   * a reader should not have to reason about why.
   */
  packages: ['shared', 'backend-runtime', 'backend-data', 'backend-services', 'provider-clients'],

  /**
   * Only `cloudflare:workers` is aliased. The family default also aliases
   * `cloudflare:sockets` and `cloudflare:workflows`; neither specifier appears in
   * this repository, and the mock's own header notes that an alias for an absent
   * mock fires only when a test imports the specifier — so listing them costs
   * nothing but implies a runtime surface this worker does not have.
   */
  mocks: ['workers'],

  backend: {
    include: ['test/**/*.test.ts'],
    // `**/node_modules/**` is Vitest's own default exclusion, and naming
    // `exclude` at all **replaces** that default rather than adding to it.
    //
    // That was harmless while `test/` was outside the workspace and had no
    // `node_modules` of its own, and it stopped being harmless the moment it
    // became a workspace project: pnpm then links `test/node_modules`, which sits
    // under the `test/**/*.test.ts` glob, and the suite collected the dependency's
    // own test files — `zod`, `@testing-library/jest-dom` and the rest, 3,000-odd
    // files and ten times the real suite's runtime. Nothing announced it: the run
    // reported failures from inside `node_modules` that belonged to no code in
    // this repository.
    //
    // `test/integration/**` has its own config against real D1, and
    // `test/floci/**` needs the emulator on 127.0.0.1:4566 and runs only under
    // `pnpm run test:floci`. Without the exclusion `pnpm test` and
    // `pnpm run checks` would pass locally and fail in CI for want of a container.
    exclude: ['**/node_modules/**', 'test/integration/**', 'test/floci/**'],

    /**
     * `@rexezuge/runtime` ships ESM `dist/` that re-exports worker bases which
     * import `cloudflare:workers`. Inlined so Vitest's resolver applies the
     * Workers mock alias instead of handing that scheme to Node — otherwise the
     * runtime barrel fails to evaluate with "Class extends value undefined",
     * taking down every suite that imports it for a reason that has nothing to do
     * with workflows.
     *
     * The factory's default is `['dofs']`; this repository has no `dofs`
     * dependency, so the override replaces rather than extends it.
     */
    serverDepsInline: ['@rexezuge/runtime'],
  },

  web: {
    environment: 'jsdom',
    include: ['test/**/*.test.tsx'],
    exclude: ['**/node_modules/**', 'test/integration/**', 'test/floci/**'],
    setupFiles: ['test/setup/dom.ts'],
  },

  coverageInclude: [
    'apps/api/src/**/*.ts',
    'apps/background/src/**/*.ts',
    // Web: services and lib are pure enough for the node project. Hooks and
    // components are covered by the `dom` project but stay out of this umbrella:
    // they are JSX-heavy and mostly markup, and including them would move the
    // aggregate without adding meaningful signal.
    'apps/web/src/services/**/*.ts',
    'apps/web/src/lib/**/*.ts',
    'packages/**/src/**/*.ts',
  ],

  coverageExclude: [
    // Barrels are already excluded by the factory; the API schema layer is pure
    // `export *` over shared and has no executable statements of its own.
    'apps/api/src/schema/**',
    // Type-only modules compile to no runnable code, so v8 reports 0% and they
    // would otherwise drag the aggregate down without any behaviour left to cover.
    'packages/backend-services/src/composition/ServiceEnv.ts',
    'packages/backend-services/src/composition/tokens.ts',
    // A Workflow class is the platform's entrypoint, like a Durable Object
    // class: it can only be constructed inside the Workers runtime, so the node
    // project cannot execute it at all. What is worth asserting about it — that
    // the cron starts one instance per tick and leaves the collection tasks to it
    // — is asserted against `CronTasksWorker` in
    // `test/workers/CronTasksWorkerContract.test.ts`.
    'apps/background/src/CollectionWorkflow.ts',
  ],

  // Raised as coverage improved (was 93/80/94/93, before that 92/78/93/92,
  // before that 91/78/93/90). Set a little under the measured figures so ordinary
  // churn does not fail the build but a real regression does.
  //
  // `pnpm run check:coverage-floor` complements this: an aggregate can be met
  // while a single security-critical file rots, which is how `MiddlewareHandlers`
  // sat at 61.5% branch while the total looked healthy. That gate pins the files
  // whose coverage *regression* would matter most.
  thresholds: { statements: 94, branches: 83, functions: 94, lines: 94 },

  reportsDirectory: './coverage',

  /**
   * The SPA is reached as `@aws-access-bridge/web/...`, and the factory derives
   * aliases for the scope only from directories it is told about — `packages/*`
   * plus `background` under `apps/`. The SPA lives under `apps/web` and is
   * published under the same scope as a workspace package, so it needs saying
   * explicitly; without this the SPA suites fail to resolve their own services
   * and hooks, which reads as a broken import rather than a missing alias.
   *
   * A plain string `find` is a prefix match in Vite, so this covers both
   * `@aws-access-bridge/web` and every `/…` beneath it. Applied to both
   * projects: a suite resolving the SPA differently from its sibling fails like a
   * product bug, and Vitest projects do not inherit the root `resolve`.
   */
  aliases: [
    {
      find: '@aws-access-bridge/web',
      replacement: fileURLToPath(new URL('apps/web/src', import.meta.url)),
    },
  ],
});
