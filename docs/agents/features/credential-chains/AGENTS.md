# Credential Chains

Scope: how long-term IAM keys become usable session credentials, and how hot chains are kept warm. Parent index: [`../../../../AGENTS.md`](../../../../AGENTS.md). Encryption details: [`../../../../packages/backend-data/AGENTS.md`](../../../../packages/backend-data/AGENTS.md). The walk itself: [`assume-role/AGENTS.md`](../assume-role/AGENTS.md).

## Storage

Long-term IAM keys live AES-GCM-encrypted in D1 (`CredentialsDAO`, an `EncryptedDAO`), one row per
principal ARN. A `credential.assumed_by` value makes that row an intermediate hop pointing at the
row it may assume, so the chain is the relation itself — there is no separate chain table.
`principalArns` is ordered **base → target**, and `CredentialsDAO.getCredentialChainByPrincipalArn`
is the single walk that produces it.

Relationships are managed through `POST|DELETE /user/admin/credentials/relationship`; access grants
through `POST|DELETE /user/admin/access`. Those are different things: a relationship says _this
principal may assume that one_, a grant says _this user may assume that role_.

Per encrypted surface the key chain is resolved by
`backend-services/composition/encryptionKeys.ts` and **injected** into the services, which is what
makes the per-feature key split non-breaking. `CREDENTIAL_ENCRYPTION_KEY_SECRET` covers the D1
table; `CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET` covers the KV namespace;
`AES_ENCRYPTION_KEY_SECRET` is the legacy single key, kept as a read-only fallback so rows written
before the split stay decryptable. Writes always use the surface's own key, so a row upgrades itself
the next time it is stored.

`AwsAccountsDAO` holds account nicknames; `RoleConfigsDAO` holds the per-role session duration and
Console destination path/region.

## Depth is bounded

`PRINCIPAL_TRUST_CHAIN_LIMIT` (default 3) bounds how many hops a walk will take, in both
`CredentialsDAO.getCredentialChainByPrincipalArn` and
`CredentialChainService.getCredentialChainToFirstCachedPrincipal`. Both use `++depth < limit` inside
a `do`/`while`, where the increment runs in the condition — `<=` would admit `limit + 1` hops. When
the limit is hit the chain walk logs and raises `InternalServerError`; the credential walk raises
`ForbiddenError` for a single-hop request, because long-term keys are deliberately not retrievable.

## The cache is a KV namespace, not a D1 table

`CredentialsCacheDAO` (an `IKeyValueDAO` under the `CC` namespace, `::` delimiter) holds temporary
STS credentials; `CredentialCacheConfigDAO` tracks `last_cached_at` per principal. Only _intermediate_
hops are cached — see [`assume-role/AGENTS.md`](../assume-role/AGENTS.md) for why both ends of the
chain are excluded and why a half-populated entry is worse than none.

`CredentialCacheRefreshTask` (cron phase 1) pre-warms chains that are due:
`getPrincipalArnsNeedingUpdate(NUMBER_OF_CREDENTIALS_TO_REFRESH, cutoff)` where the cutoff is
`CREDENTIAL_REFRESH_INTERVAL_MINUTES` (default 45) old. It walks each chain and bumps
`last_cached_at` once per principal **after** the walk, so a one-hop chain with nothing to cache
still leaves the batch rather than looping on it forever.

Each principal is isolated in its own `try`: one unresolvable chain — a credentials row deleted out
from under a stale `credential_cache_config` entry — must not abort the remaining principals.

Because the cron only refreshes once stale, rotating an IAM key takes up to
`CREDENTIAL_REFRESH_INTERVAL_MINUTES` to take effect. Locally, drive a cycle with
`pnpm exec wrangler dev --test-scheduled` and `GET /__scheduled?cron=*%2F10+*+*+*+*`; there is no
production HTTP trigger.

## Cache reads are tolerant, row reads are not

`decryptDataField` throws when an envelope is present and unreadable, but answers `undefined` for an
absent column. `decryptDataTolerant` answers `undefined` for both and is used **only** for the KV
cache, whose entries are disposable — a corrupt one is evicted rather than raised. Using the
tolerant variant for a D1 row would turn a key-rotation mistake into a silently missing credential.

A KV `delete` must namespace the key like `get` and `put` do; deleting the raw key silently no-ops.
