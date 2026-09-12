# AWS-AccessBridge — Testing

Scope: unit + integration tests. Parent index: `../../../AGENTS.md`.

Current thresholds (`vitest.config.mts`): **statements 75 / branches 65 / functions 65 / lines 75**. Exclusions: `**/*.test.ts`, `**/*.d.ts`, `**/index.ts`, `**/types.d.ts`, `**/model/**` (pure TS types). Integration tests in `test/integration/` use `@cloudflare/vitest-pool-workers` (no V8 coverage — no thresholds there, omitted intentionally).

**Covered** (test files exist): constants, crypto (`aes-gcm`, `hmac`), DAOs (assumable roles, accounts, costs, credential cache config, credentials, collection config, resources, role configs, spend alerts, team accounts, PATs, favorites, metadata, KV), errors, middleware (HMAC, handlers), models, request validation schemas, utils (ARN, console URL, base URL, email, error translation, origin, timestamp, UUID), workers (`AccessBridgeWorker`, `CronTasksWorker`), task registry + pruning tasks, seams (`Clock`, `Logger`), i18n locale parity, routes (base + admin guard).

**Mock patterns**:

- DAO tests: `createMockDb()` returning `prepare().bind().run/first/all` chain with shared `vi.fn()` refs.
- Services with DAOs: `vi.mock('@aws-access-bridge/backend-data/dao')`.
- Crypto: `vi.mock('@aws-access-bridge/backend-data/crypto')`.
- Cron tasks in worker tests: `vi.mock('@aws-access-bridge/background/scheduled')` with `tasksForPhase` phase stubs.
- Use `vi.hoisted()` for mocks referenced across `vi.mock` factories.
- `beforeEach` + `vi.clearAllMocks()` resets call counts.
