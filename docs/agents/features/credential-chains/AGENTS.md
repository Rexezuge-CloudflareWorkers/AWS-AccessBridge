# Credential Chains

Scope: how long-term IAM keys become usable session credentials, and how hot chains are kept warm. Parent index: [`../../../../AGENTS.md`](../../../../AGENTS.md). Encryption details: [`../../../../packages/backend-data/AGENTS.md`](../../../../packages/backend-data/AGENTS.md). The walk itself: [`assume-role/AGENTS.md`](../assume-role/AGENTS.md).

## Storage

Long-term IAM keys live AES-GCM-encrypted in D1 (`CredentialsDAO`, an `EncryptedDAO`), one row per principal ARN. A `credential.assumed_by` value makes that row an intermediate hop pointing at the row it may assume, so the chain is the relation itself — there is no separate chain table. `principalArns` is ordered **target → base** (`principalArns[0]` is the role being reached, the last entry is the base IAM user), and `CredentialsDAO.getCredentialChainByPrincipalArn` is the single walk that produces it.

A relationship (`POST|DELETE /user/admin/credentials/relationship`) says _this principal may assume that one_; a grant (`POST|DELETE /user/admin/access`) says _this user may assume that role_ — different things. A relationship write and a credential removal both invalidate the principal's KV entry (`CredentialsCacheDAO.invalidate`), so a re-pointed chain cannot be served from a stale hop; a lowered `PRINCIPAL_TRUST_CHAIN_LIMIT` still leaves entries cached under the old limit until they age out with their credentials.

Per encrypted surface the key chain is resolved by `backend-services/composition/encryptionKeys.ts` and **injected** into the services, which keeps a service from building a second scope: `CREDENTIAL_ENCRYPTION_KEY_SECRET` covers the D1 table, `CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET` the KV namespace. Each chain holds one key; the legacy single `AES_ENCRYPTION_KEY_SECRET` and its read fallback are gone, and the DAOs still accept a longer chain so a rotation can append the outgoing key. `AwsAccountsDAO` holds account nicknames; `RoleConfigsDAO` the per-role session duration and Console destination.

## Depth is bounded, and the bound is the chain's

`PRINCIPAL_TRUST_CHAIN_LIMIT` (default 3) bounds how many principals a chain may have. A longer chain is **refused** (`InternalServerError`, walk logged at `error`) by both walks — `CredentialsDAO.getCredentialChainByPrincipalArn` (the cron and collection tasks) and `CredentialChainService.getCredentialChainToFirstCachedPrincipal` (interactive). The credential walk still answers a single-hop request with `ForbiddenError`, because long-term keys are deliberately not retrievable.

Two things are load-bearing:

- **Depth is decided on its own**: "did the walk stop with `assumed_by` still set?", never folded into the key check below it. An operator can store credentials for any principal ARN, mid-chain ones included, so whether the row a walk stops on carries keys says nothing about whether the chain is over-long — reading it that way once served a four-principal chain as a silent three-hop prefix, with the `exceeds the maximum allowed depth` line unreachable.
- **The cache must not decide depth.** `getCredentialChainToFirstCachedPrincipal` skips the cache at the boundary position — the last one the budget reaches — because that hop is exactly the one whose successor is unknown, and a hit there would answer "the chain is fine" without asking. Positions below the boundary still short-circuit and cost no extra row read; only the rejected case pays.

The bound is the `throw` inside the loop, not a term in the `while` condition: a counter incremented in the condition drifts out of step with the counter the check reads. It is also what still terminates a cyclic `assumed_by` relation.

## The cache is a KV namespace, not a D1 table

`CredentialsCacheDAO` (an `IKeyValueDAO` under the `CC` namespace, `::` delimiter) holds temporary STS credentials; `CredentialCacheConfigDAO` tracks `last_cached_at` per principal. Only _intermediate_ hops are cached — see [`assume-role/AGENTS.md`](../assume-role/AGENTS.md) for why both ends of the chain are excluded and why a half-populated entry is worse than none.

`CredentialCacheRefreshTask` (cron phase 1) pre-warms chains that are due: `getPrincipalArnsNeedingUpdate(NUMBER_OF_CREDENTIALS_TO_REFRESH, cutoff)` where the cutoff is `CREDENTIAL_REFRESH_INTERVAL_MINUTES` (default 45) old. It walks each chain and bumps `last_cached_at` once per principal **after** the walk, so a one-hop chain with nothing to cache still leaves the batch rather than looping on it forever.

Four scheduling rules, each with one reason:

- **Only a principal that sits in a chain is registered.** `credential_cache_config` gets a row from `storeCredentialRelationship` — the role whose `assumed_by` points somewhere — not from `storeCredential`. A base principal's length-1 chain can only fail as "long-term credentials are not retrievable", and registering those filled the front of `ORDER BY last_cached_at` with rows that could only fail. A length-1 chain arriving here is skipped quietly.
- **`last_cached_at` is stamped on failure as well as success**: a row that always throws would otherwise sort first forever and starve every principal behind it. The error is still logged and counted in `itemsFailed`.
- **An over-long chain counts as a failure, deliberately, unlike the length-1 skip**: there is nothing to warm for a chain that must not be served, so it fails every cycle and stays visible in the maintenance tab until an operator raises the limit or shortens the chain.
- **Each principal is isolated in its own `try`**: one unresolvable chain — a credentials row deleted out from under a stale config entry — must not abort the remaining principals.

Regression test: `test/integration/api/CredentialPrewarm.int.test.ts` (real D1 and KV, stubbed STS). Because the cron only refreshes once stale, rotating an IAM key takes up to `CREDENTIAL_REFRESH_INTERVAL_MINUTES` to take effect. Locally, drive a cycle with `pnpm exec wrangler dev --test-scheduled` and `GET /__scheduled?cron=*%2F10+*+*+*+*`; there is no production HTTP trigger.

## Cache reads are tolerant, row reads are not

`decryptDataField` throws when an envelope is present and unreadable, but answers `undefined` for an absent column. `decryptDataTolerant` answers `undefined` for both and is used **only** for the disposable KV cache — a corrupt entry is evicted rather than raised. Using the tolerant variant for a D1 row would turn a key-rotation mistake into a silently missing credential. A KV `delete` must namespace the key like `get` and `put` do; deleting the raw key silently no-ops.
