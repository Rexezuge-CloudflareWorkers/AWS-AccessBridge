# AWS-AccessBridge — Backend Data (D1 / KV)

Scope: `packages/backend-data/**`. Parent index: `../../AGENTS.md`. Layer 2: may import layers 0–1 only. Workspace and layer rules: [`../../docs/agents/repo/AGENTS.md`](../../docs/agents/repo/AGENTS.md).

## The DAO inventory

All D1 access goes through a DAO extending `BaseDAO` (`ctor(database: D1Queryable)`, `withRetry()`,
`deleteOrphanedRows()`). `EncryptedDAO` adds `encryptionKeys` — an ordered chain, own key first — for
encrypted rows. Deployed chains hold a single key; the list shape is kept for rotation. Never redeclare `database`; it is `protected readonly` on
the base.

| DAO                                               | Holds                                                      | Notes                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `CredentialsDAO`                                  | long-term IAM keys, encrypted                              | `EncryptedDAO`; `resolveIv` reads pre-0031 rows                                          |
| `CredentialsCacheDAO`                             | temporary STS credentials, encrypted                       | KV, via `IKeyValueDAO`; corrupt entries are evicted                                      |
| `AwsAccountsDAO`                                  | connected accounts, nicknames                              | `deleteOrphaned()`                                                                       |
| `RoleConfigsDAO`                                  | per-role session duration, destination path/region         | `deleteOrphaned()`                                                                       |
| `AssumableRolesDAO`                               | the grants themselves                                      | + `AssumableRolesQueries` (SQL fragments) and `AssumableRolesMapper` (pure row mapping)  |
| `UserMetadataDAO`                                 | the account row: anchor, `id`, `current_email`, superadmin | `newId()`, `ensureUserEmailExists()`                                                     |
| `UserEmailDAO`                                    | the `user_emails` address registry                         | `is_verified = 1` may authenticate                                                       |
| `UserFavoriteAccountsDAO`                         | favourites                                                 | delegates its owner clause                                                               |
| `UserAccessTokenDAO`                              | PATs                                                       | FK target is the **anchor**, `ON DELETE CASCADE`                                         |
| `AuditLogDAO`                                     | the audit trail                                            | `deleteOlderThanBatch()`, `query()`                                                      |
| `BackgroundTaskRunDAO`                            | cron run history                                           | `deleteOlderThanBatch()`                                                                 |
| `CostDataDAO`                                     | collected spend, keyed `(account, period_start)`           | `INSERT OR REPLACE`                                                                      |
| `SpendAlertDAO`                                   | alert thresholds                                           | storage only — see [cost-analytics](../../docs/agents/features/cost-analytics/AGENTS.md) |
| `DataCollectionConfigDAO`                         | which principal collects what, and when                    | `deleteOrphaned()`                                                                       |
| `CredentialCacheConfigDAO`                        | `last_cached_at` per principal                             | drives the phase-1 refresh batch                                                         |
| `ResourceInventoryDAO`                            | collected resources                                        | `deleteStaleResources()` per type                                                        |
| `TeamsDAO` / `TeamMembersDAO` / `TeamAccountsDAO` | team workspaces                                            | members carry `admin`/`member` roles                                                     |
| `IKeyValueDAO`                                    | the KV contract                                            | `get`/`put`/`delete` all namespace the key                                               |
| `BatchSize` (`dao/BatchSize.ts`)                  | `toSafeBatchSize`                                          | batch sizes, not page sizes                                                              |

`utils/` holds `D1Utils` (`executeD1WithRetry`, `assertD1Success`), `D1ErrorClassifier`
(`isD1ErrorRetryable`, `isMissingSchemaError`), `D1SessionUtil` (`D1Queryable`,
`createD1SessionEnv`) and `LIKEUtil`. `crypto/` holds `aes-gcm` and `hmac`. `constants/d1/` and
`constants/kv/` hold the session constraint and the KV namespaces, TTLs and value types.

## Every write goes through `withRetry`

D1 resolves a failed statement with `{success: false}` rather than throwing, so a DAO that checks
`result.success` by hand is checking only the route that throws. **`assertD1Success` is the one
place that check is written**, and `executeD1WithRetry` calls it rather than reimplementing it, so
both D1 failure routes converge on one policy. The check used to be inlined at 31 call sites across
10 DAOs, which meant `isD1ErrorRetryable` applied to exactly one write and a fix to the policy
would have silently missed the rest. A thrown value that is not an `Error` is re-thrown untouched
rather than wrapped.

`isMissingSchemaError` recognises a missing table or column **only**. It exists so a partially
migrated database still authenticates; widening it would swallow a constraint violation or a
timeout, which is a far worse failure to explain.

## The 0032 owner predicate has one definition

`AssumableRolesQueries.ownerClause(alias)` is
`(alias.user_id = ? OR (alias.user_id IS NULL AND alias.user_email = ?))`, and
`TeamMembersDAO`, `UserFavoriteAccountsDAO` and `UserAccessTokenDAO` all delegate to it rather than
carrying their own copy. They previously had four, each with its own prose explanation, so a fix to
one silently missed the others.

The `IS NULL` guard is load-bearing: without it an address an account has moved away from would
also match a different account's row. A DAO method taking a `null` `userId` narrows to the address
arm alone. The rationale for the whole model — why `user_email` is a frozen anchor and cannot be
repointed — is in [`../../docs/agents/features/identity/AGENTS.md`](../../docs/agents/features/identity/AGENTS.md).

## `user_email` is an anchor, not a field

`migrations/0032_user_identity.sql` added `user_metadata.id` (`usr_<hex>`, the stable account key),
`user_metadata.current_email` (the mutable sign-in address) and the `user_emails` registry, and left
`user_email` as the frozen anchor: still the primary key, still the target of live foreign keys from
`assumable_roles`, `user_favorite_accounts` and `user_access_tokens` (the last `ON DELETE CASCADE`).
The migration is purely additive for that reason.

So a `*_email` / `created_by` column is written with the **anchor** — it is the FK target and, for
`assumable_roles` / `user_favorite_accounts` / `team_members`, half of a primary key — while
identity-keyed reads and writes go through `user_id`. User-keyed DAO methods therefore take an owner
object (`AssumableRoleOwner` / `TeamMemberOwner`), never a bare address.

`UserMetadataDAO.ensureUserEmailExists` stamps `id` and `current_email` on insert. A row created
after 0032 is never backfilled again, so provisioning without them leaves a permanently unresolvable
account whose tokens and grants carry a NULL `user_id` that fails the foreign keys added alongside
them. `getOrCreateFederationUsername` calls it first and then writes the username with an `UPDATE`,
because D1 does not enforce foreign keys by default: an `assumable_roles` row can already exist
with no metadata row, and this path becomes that account's first writer.

`0032` assigns `current_email` only where the lowercased address is unambiguous, so a live database
holding both `Alice@x.com` and `alice@x.com` is neither merged (a privilege escalation) nor failed
(a unique-index violation). Those rows keep `current_email IS NULL` and resolve via the anchor.

## Encryption: one IV per field, a chain of keys per row

Every encrypted field gets its own random 96-bit AES-GCM IV, in its own column (`salt`,
`salt_secret_access_key`, `salt_session_token`). **Never reuse an IV across fields under one key**:
it leaks the XOR of the plaintexts and enables tag forgery. `encryptData` therefore accepts no IV
argument.

Decryption takes a _chain_, not one key: `decryptDataWithKeys` / `decryptDataField` walk it in
preference order, which is what lets a rotation append the outgoing key — a wrong key fails
GCM's tag check rather than returning garbage, so trying the next one is safe. `decryptDataField`
answers `undefined` for an absent column (a relationship-only `credentials` row legitimately has
none) but throws when an envelope is present and unreadable; `decryptDataTolerant` answers
`undefined` for both and is only for the disposable KV cache.

Rows written before `migrations/0031_distinct_credential_ivs.sql` carry only `salt`. Reads fall
back to it — `CredentialsDAO.resolveIv`, and the same fallback in `CredentialsCacheDAO` — so old rows
keep working and are upgraded on their next write.

## A KV `delete` must namespace the key

`IKeyValueDAO.get`/`put`/`delete` all route through `toNamespacedKey`. Deleting the raw key silently
no-ops, because every read and write is namespaced.

## LIKE metacharacters must be escaped

`%`, `_` and `\` in a user-supplied search term are wildcards, so searching for `%` returns every
row. Use `LIKEUtil.contains(term)` for the pattern and `LIKEUtil.escapeClause` (`ESCAPE '\'`) in
the SQL. `AssumableRolesQueries.buildSearchRolesQuery` and `ResourceInventoryDAO.searchResources`
both do.

## A batch size is not a page size

`getPrincipalArnsNeedingUpdate` and `getPrincipalArnsNeedingCollection` take a per-tick _batch_
size, so they are guarded by `toSafeBatchSize` against only the non-positive and non-integer values
D1 rejects. Clamping them to `Pagination.MAX_LIMIT` would silently change how much work a tick does.
`Pagination` lives in `backend-runtime` (Layer 1) and must not be imported here; the clamp for a
_page_ size belongs in the Layer 3 service, which is why `MaintenanceService.listTaskRuns` clamps
rather than its DAO.

## Conventions

- Failed writes throw `DatabaseError` on `!result.success`; its `retryable` flag drives the
  `executeD1WithRetry` backoff.
- Batch deletes expose `deleteOlderThanBatch(cutoff, batchSize): Promise<number>` (D1
  `DELETE … LIMIT ?`, `meta.changes ?? 0`) for `AbstractPruningTask`.
- Models come from `@aws-access-bridge/shared/model` as dual camelCase/snake_case `Type` /
  `TypeInternal` pairs.
- Routes must not import DAOs. ESLint enforces this under `apps/api/src/endpoints/**`, type-only
  imports excepted — compose a `backend-services` domain service instead.
