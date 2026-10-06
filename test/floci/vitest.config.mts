import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// A third Vitest project, alongside `node`/`dom` in the root config and the
// workerd-hosted `test/integration/` one. Separate because these tests need a
// running Floci emulator on 127.0.0.1:4566, which `pnpm test` and
// `pnpm run checks` must never require. `test/floci/**` is excluded from the
// root `node` project's glob for the same reason.
//
// Node rather than workerd: the subjects here are the signed-fetch clients and
// the collectors, none of which touch a Workers API. A workerd-hosted variant
// would only re-add the runtime without testing anything new.
const apiSrcPath = fileURLToPath(new URL('../../apps/api/src', import.meta.url));
const backgroundSrcPath = fileURLToPath(new URL('../../apps/background/src', import.meta.url));
const backendDataSrcPath = fileURLToPath(new URL('../../packages/backend-data/src', import.meta.url));
const backendErrorsSrcPath = fileURLToPath(new URL('../../packages/backend-errors/src', import.meta.url));
const backendRuntimeSrcPath = fileURLToPath(new URL('../../packages/backend-runtime/src', import.meta.url));
const backendServicesSrcPath = fileURLToPath(new URL('../../packages/backend-services/src', import.meta.url));
const providerClientsSrcPath = fileURLToPath(new URL('../../packages/provider-clients/src', import.meta.url));
const sharedSrcPath = fileURLToPath(new URL('../../packages/shared/src', import.meta.url));

export default defineConfig({
  test: {
    name: 'floci',
    globals: true,
    environment: 'node',
    include: ['test/floci/**/*.test.ts'],
    // One readiness probe for the run, not one per file: see global-setup.ts.
    globalSetup: ['test/floci/global-setup.ts'],
    // Every test here crosses a process boundary, so the 5s default is not the
    // question. 30s is, and it is generous: once the emulator answered `S3` in
    // 227ms, EC2 in 7ms and Lambda in 3ms in the same run. It was raised to 60s
    // in the belief that the RDS case was waiting on a warming emulator — that
    // was wrong, and the same test then failed at 60s too. The cost it really was
    // paying was emulator-side: without `FLOCI_SERVICES_RDS_MOCK` the seeded
    // `CreateDBInstance` reaches for Docker before falling back to metadata, and
    // Floci 2.2.0 retries every Docker call internally (see `helpers/seed.ts`),
    // so the seed cost tens of seconds no matter what this number was.
    //
    // A wedged emulator call is now bounded per request by `REQUEST_TIMEOUT_MS`
    // in `helpers/floci.ts`, which fails naming the service that hung — a far
    // better report than this budget expiring anonymously.
    testTimeout: 30_000,
    hookTimeout: 90_000,
    // Serialized on purpose. Most files seed distinct resource names into the
    // shared throwaway account and would tolerate running concurrently, but the
    // Cost Explorer assertions read that account's aggregate S3 spend, so a
    // concurrent bucket create would move the numbers under them. Serializing
    // costs seconds here and removes a whole class of ordering flake.
    fileParallelism: false,
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
      { find: /^@\//, replacement: `${apiSrcPath}/` },
    ],
  },
});
