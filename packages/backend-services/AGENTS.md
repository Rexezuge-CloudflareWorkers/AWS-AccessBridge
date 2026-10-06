# AWS-AccessBridge — Backend Services (Business Logic)

Scope: `packages/backend-services/**`. Parent index: `../../AGENTS.md`. Layer 3: may import layers 0–2, never `apps/*`. Workspace and layer rules: [`../../docs/agents/repo/AGENTS.md`](../../docs/agents/repo/AGENTS.md).

Every service is constructed by the composition root and nowhere else. There are no `*Factory`
classes; a caller resolves `getRequestScope(cxt).get(Tokens.X)` and a test swaps the token.

## The service map

| Directory          | Service                                                                               | Token                           | Owns                                                         |
| ------------------ | ------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------ |
| `access/`          | `AccessService`                                                                       | `Tokens.AccessService`          | grant / revoke a role for a user                             |
| `account/`         | `AccountService`                                                                      | `Tokens.AccountService`         | account nicknames, per-role config, IAM role discovery       |
| `audit/`           | `AuditService`                                                                        | `Tokens.AuditService`           | observer fan-out, request→event mapping, log queries         |
| `auth/`            | `AccessAuthService`                                                                   | `Tokens.AccessAuthService`      | Cloudflare Access identity (JWT, demo, dev bypass)           |
| `auth/`            | `TokenService`                                                                        | `Tokens.TokenService`           | PAT authentication and token CRUD                            |
| `auth/`            | `ReplayGuard`                                                                         | —                               | single-use enforcement for internal HMAC signatures          |
| `aws/assume-role/` | `AssumeRoleService`                                                                   | `Tokens.AssumeRoleService`      | access check → chain → cached hop → chain walk               |
| `aws/ce/`          | `CostExplorerService`                                                                 | `Tokens.CostExplorerService`    | thin delegate over `CostExplorerClient`                      |
| `aws/collectors/`  | `BaseAwsCollector` + 5 collectors, `CollectorRegistry`, `InjectableCollectorRegistry` | `Tokens.CollectorRegistry`      | EC2/S3/Lambda/RDS/DynamoDB discovery                         |
| `aws/console/`     | `ConsoleService`                                                                      | `Tokens.ConsoleService`         | federation signin tokens and Console URL builders            |
| `aws/iam/`         | `IamService`                                                                          | `Tokens.IamService`             | thin delegate over `IamClient` (`ListRoles`)                 |
| `aws/sts/`         | `StsService`                                                                          | `Tokens.StsService`             | `assumeRole`, `GetCallerIdentity`                            |
| `cost/`            | `CostService`                                                                         | `Tokens.CostService`            | summary / per-account / trends, alerts, collection config    |
| `credential/`      | `CredentialChainService`                                                              | `Tokens.CredentialChainService` | chain resolution, chain short-circuit, leaf walk, test-chain |
| `credential/`      | `CredentialStoreService`                                                              | `Tokens.CredentialStoreService` | store / relationship CRUD, STS credential validation         |
| `identity/`        | `UserIdentityService`                                                                 | `Tokens.UserIdentityService`    | address → account resolution; one instance per scope         |
| `maintenance/`     | `MaintenanceService`                                                                  | `Tokens.MaintenanceService`     | orphan cleanup, task-run listing                             |
| `resource/`        | `ResourceService`                                                                     | `Tokens.ResourceService`        | inventory search and summary                                 |
| `team/`            | `TeamService`                                                                         | `Tokens.TeamService`            | teams, members, team accounts                                |
| `user/`            | `UserService`                                                                         | `Tokens.UserService`            | profile, favorites, hidden roles, assumables                 |

There is no `CredentialService` facade over the two credential services. It was self-documented as
kept only for compatibility, every method forwarded to one of the two, and it was still the token
every caller resolved — so it is gone rather than deprecated.

## The composition root

`composition/` is the only place a service is built. `createRequestScope(env)` returns a fresh
`Container`; `getRequestScope(cxtOrEnv)` returns the cached scope for that unit of work.

**Request handlers must pass the Hono context; cron and Durable Object tasks pass `env` and call
`createRequestScope` themselves.** Keying on `env` looks right — Workers hand one object to every
handler in a request — but `route-helpers.withUnconstrainedD1Session` spreads `c.env` into a _new_
object, so an env-keyed lookup missed on every request and built two or three containers where
there should be one: two or three secret fetches, and the identity memo re-running. A Durable Object
has the opposite problem — its `env` is stable for the object's lifetime, so a cached scope would
pin the memoized encryption keys after a rotation. Fresh per run is the correct answer there.

`ServiceEnv` (`composition/ServiceEnv.ts`) is the single source of truth for what a service may
read, and each service narrows it into its own `*ServiceEnv`. That is what makes the root type-safe
without casts: the previous arrangement needed `env as never` at all 15 bindings, and `as never` is
assignable to everything, so a service could have been wired to an env missing a binding it needed
with the compiler staying silent. Each key is declared rather than hidden behind an index signature,
so reaching for an undeclared config key is a compile error instead of a runtime `undefined`.

`Tokens.UserIdentityService` is bound once per scope, which is what makes `UserIdentityService`'s
address→account memo a per-request cache rather than a cross-request leak.

`composition/encryptionKeys.ts` holds the per-feature key chains (`Tokens.CredentialKey`,
`Tokens.CredentialCacheKey`) and **injects** them into `CredentialChainService` and
`CredentialStoreService`. The services do not look them up: a service holds only `env`, which is not
the request's identity, so a lookup inside one would build a second scope and defeat the memo.

## Identity is resolved in one place

`identity/resolveOwner.ts` exports `resolveOwner(identity, userEmail)` → `{userId, anchorEmail}`,
the owner every user-keyed DAO statement is keyed on. Use it rather than re-deriving either half:
the pair was written out fifteen times across seven services, and `AccessService` and
`AssumeRoleService` inlined it at their call sites instead of calling a helper at all.

An unresolvable address still yields an owner, with a null id, so an unknown actor reads as "no
accounts" rather than erroring — a 404 on an unknown caller would turn the address space into an
account-enumeration oracle.

Services take the caller's sign-in **address** and resolve the account internally; the route, the
OpenAPI document, and the web client all stay address-based. Every write targets the resolved
**anchor**, never the presented address. See
[`../../docs/agents/features/identity/AGENTS.md`](../../docs/agents/features/identity/AGENTS.md).

`identity/` is two classes because their safety arguments differ. `UserIdentityService` resolves an
address to an account (`user_emails` registry first, where only `is_verified = 1` may
authenticate, then `user_metadata.current_email`, then the frozen anchor as the pre-0032 floor) and
memoizes per scope. `AddressRegistryService` manages addresses — claim-then-revoke ordering,
case-insensitive claim checks — and the resolver re-exposes `listAddresses`, `setPrimaryEmail` and
`linkVerifiedEmail` so callers still hold one object. `idOf(account)` is the one place an empty id
becomes `null` for a `user_id` write, since binding `''` fails the 0032 foreign keys.

## A failure is not an empty answer

Every place this code once turned a failure into an empty result now throws, because a caller that
treats an empty answer as authoritative deletes real data.

- **`BaseAwsCollector`** throws `AwsCollectionError` (carrying `status` + `resourceType`, with
  `retryable` set for 429/5xx) on a non-OK response **or** a malformed body, rather than resolving
  to `[]`. `ResourceInventoryCollectionTask` prunes previously collected rows for every type that
  "succeeded", so an empty list from a 403 would delete a real account inventory. The task catches
  per collector and skips pruning for any type that threw; an empty-but-successful call still
  prunes, because "this account has none" is a real answer. `fetchText` / `fetchJson` /
  `fetchJsonWithInit` are the shared parse helpers all five collectors use.
- **`collectAllRegions`** never throws for a regional failure: a role denied in one region still has
  the other 26, and discarding those would make one `AccessDenied` erase a real inventory. It
  returns `{items, succeededRegions, failedRegions}` and the task keys pruning on completeness.
- **`AuditObserverRegistry.notifyAll`** fans out with `allSettled` and logs each rejection itself
  instead of returning the settled results, because `record` discarded them and a failed
  `AuditLogDAO.create` vanished with no trace.
- **`MaintenanceService.cleanupOrphanedData`** settles its seven table deletes independently and
  reports per-table `failures`. Running them in sequence let one busy table abort the other six and
  answer 500 with no indication of how far it got; once the DAOs gained their `success` checks, a
  partial run could also report success.
- **`ListAuditLogsRoute`** resolves the searched address to an account id and passes **both** to
  `AuditLogDAO.query`. The address arm of the owner predicate is the `user_id IS NULL` fallback,
  which an attributed row never takes, so filtering by a _current_ address alone returned nothing
  after a user's address changed.
- **`AuditService.record`** never lets a logging failure surface as a request failure; the write is
  on the request's own best-effort path.

## Retries classify both failure routes

`http/RetryingAwsClient` uses `isRetryableHttpStatus` for the status route and
`isRetryableThrownError` for the _rejection_ route, which prefers a carrier's own `retryable` flag
and otherwise matches permanent patterns before transient ones. Previously every rejection was
retried, so an `AccessDenied` or `ExpiredToken` on the STS assume-role path burned all three
attempts plus the backoff schedule — a permanent failure presenting as a slow one.

It also **declines** a `Retry-After` beyond `MAX_RETRY_DELAY_MS` rather than shortening it. The
header is stated in seconds for a client that can wait indefinitely, and honouring `Retry-After: 120`
inside a Workers request would sleep past the request's own wall-clock limit, turning a throttle
into a timeout. A shorter sleep only earns another throttle.

`http/` is one concern per file: `IHttpClient.ts` (interface + `FetchHttpClient` +
`parseJsonBody`), `HttpFetchError.ts` (the two classifiers), `RetryingAwsClient.ts`,
`StubHttpClient.ts` (the scriptable double, part of the published surface — a consumer testing a
service that takes an `IHttpClient` needs one), and `index.ts` re-exporting `AwsClient*` types from
`provider-clients`.

## Logging redacts at the sink

Redaction lives in `shared/utils/Logger`, not at the call sites, so a future call site that forgets
still cannot leak a `SecretAccessKey` / `SessionToken` / PAT / HMAC secret into a retained log tail.
Two independent heuristics, both deny-lists and documented as incomplete: key-name fragments, and
value _shapes_ (`AKIA`/`ASIA` key ids, JWTs, hex digests), so a secret interpolated into free text
or pasted under a harmless key is still caught. Errors reduce to their message, and a circular field
bag degrades to a note rather than overflowing while reporting a failure.

Prefer `log.info` / `log.warn` / `log.error` from `@aws-access-bridge/shared/utils` over a bare
`console.*`: there is no local `DEBUG` filter on purpose (Cloudflare already samples, and a local
filter would silently swallow production diagnostics), and nothing changes wrangler's JSON logging,
which alters billing-visible behaviour.

## Pure statics stay static

`aws/ArnUtil`, `aws/BaseUrlUtil`, `aws/InternalRequestHelper` (instance — it holds a fetcher and a
secret), `error/ErrorTranslationUtil`, `error/ErrorDeserializationUtil`.

## One naming collision to know

In `AssumeRoleService`, the local named `userId` is the STS `RoleSessionName` (from
`federation_username`), **not** the account id. The account id is `owner.userId`.

## Related packages

- `shared/` — constants (canonical `StsMessages` / `HmacMessages`), models (dual camelCase /
  snake_case `Type` / `TypeInternal` pairs), schemas, and utils: `TimestampUtil` (current-time reads
  take an optional `Clock`, defaulting to `SystemClock`), `Clock` / `SystemClock` / `FixedClock`,
  `Logger`, `UUIDUtil`, `RequestOriginUtil`, `EmailUtil`, `LocaleUtil`, `MoneyUtil`, and
  `RegexUtil.matchAll`. There is no backend locale bundle — `shared/src/i18n/` and its twelve empty
  tables were deleted, so `getBackendStrings('de').locale` used to answer `'en'` while a test
  asserted that wrong answer as correct.
- `backend-errors/` — `BadRequestError`, `UnauthorizedError`, `ForbiddenError`,
  `MethodNotAllowedError`, `ConflictError`, `InternalServerError` (+ the
  `DefaultInternalServerError` singleton every 5xx is answered with), `DatabaseError` (+`retryable`),
  `AwsCollectionError`, and the `IServiceError` taxonomy they implement.
- `backend-runtime/` — `ConfigurationDefaults`, `ConfigurationManager` (namespaced getters) and
  `EnvParser`; the `di/` `Container`; abstract worker bases; DO naming constants and `Pagination`;
  the checked-in `env.d.ts` binding source of truth.
- `provider-clients/` — the raw AWS layer: `AwsSignedFetcher` plus `StsClient` /
  `CostExplorerClient` / `IamClient`. The services above are thin domain delegates over these.
