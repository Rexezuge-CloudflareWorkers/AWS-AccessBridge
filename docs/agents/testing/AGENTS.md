# AWS-AccessBridge — Testing

Scope: unit + integration tests. Parent index: `../../../AGENTS.md`.

Current thresholds (`vitest.config.mts`): **statements 85 / branches 75 / functions 75 / lines 85**. Coverage `include`: `apps/api/src/**`, `apps/background/src/**`, `apps/web/src/services/**` + `apps/web/src/lib/**`, `packages/**/src/**`. Exclusions: `**/*.test.ts`, `**/*.d.ts`, `**/index.ts`, `**/types.d.ts`, `**/model/**` (pure TS types). Web components/hooks need jsdom + `@testing-library/react` (documented follow-up — scoped out, not silently omitted). Integration tests in `test/integration/` use `@cloudflare/vitest-pool-workers` (no V8 coverage — no thresholds there, omitted intentionally).

**Covered** (test files exist): constants, crypto (`aes-gcm`, `hmac`), DAOs (assumable roles + Queries/Mapper split, accounts, costs, credential cache config, credentials, collection config, resources, role configs, spend alerts, team accounts, PATs, favorites, metadata, KV; `BaseDAO` helpers; data-layer depth suites), errors, middleware (HMAC incl. negative matrix, handlers), models, request validation schemas (+ shared schema branches), utils (ARN, console URL, base URL, email, error translation, origin, timestamp, UUID; D1 utils/classifier/session; cursor + repository helpers; provider-clients parsers), workers (`AccessBridgeWorker`, `CronTasksWorker`), task registry + pruning tasks + scheduled seams (`IScheduledTask` factory, `AbstractCollectionTask` template), seams (`Clock`, `Logger`, `Container`, `StubHttpClient` queue, `EnvParser` + `ConfigurationManager` namespaces), routes (base + admin guard + route-helpers), services direct (`CredentialChain/Store` slices + facade, `TokenService` lifecycle, `AuditService` registry + payload builder, `CollectorRegistry` + injectable), composition (`createRequestScope`), i18n locale parity, web lib/services (`shellExport`, `apiRequest`, teams/audit/admin/account/cost/resource/auth services, format).

**Integration** (`test/integration/api/`): `UserMe` (profile + OpenAPI), `AdminGuard` (non-super-admin 401 matrix over 9 admin routes + unauthenticated `/api/*` 401s), `UserData` (empty assumables/costs/resources + full PAT mint→list→use→revoke lifecycle incl. 400-proves-auth and revoked-401).

**Mock patterns**:

- DAO tests: `createMockDb()` returning `prepare().bind().run/first/all` chain with shared `vi.fn()` refs.
- Services with DAOs: `vi.mock('@aws-access-bridge/backend-data/dao')`.
- AWS clients: `vi.mock('@aws-access-bridge/backend-services/aws/sts')` then `vi.mocked(StsService.prototype.assumeRole)`; same for `CostExplorerService`, `IamService`, `ConsoleService` (partial-mock the module and override only `getSigninToken` to keep URL builders real). Raw parsers tested directly via `provider-clients` `StsClient`/`CostExplorerClient`/`IamClient` with stub signed-fetch.
- Collector registry: `vi.mock('@aws-access-bridge/backend-services/aws/collectors')` with a `CollectorRegistry.getAll` returning hoisted stub collectors (`{ resourceType, collect: vi.fn() }`); `createCollectorRegistry(overrides)` covers service-level override tests; `InjectableCollectorRegistry.withOverrides` covers hermetic tests.
- `TokenService`/`AccessAuthService`: direct lifecycle tests with mocked `UserAccessTokenDAO`; `AccessAuthService.verifyAccessJwt` is pure-static for JWT cases, instance `getAuthenticatedUserEmail` for demo/dev bypass.
- Audit: pass stub `IAuditObserver`s to `AuditService`/`AuditObserverRegistry` to isolate fan-out (`Promise.allSettled` isolation asserted).
- Crypto: `vi.mock('@aws-access-bridge/backend-data/crypto')`.
- Cron tasks in worker tests: `vi.mock('@aws-access-bridge/background/scheduled')` with `tasksForPhase` phase stubs.
- Web services: `vi.stubGlobal('fetch', ...)` with fresh `Response` per call (bodies are single-use).
- Use `vi.hoisted()` for mocks referenced across `vi.mock` factories.
- `beforeEach` + `vi.clearAllMocks()` resets call counts.
