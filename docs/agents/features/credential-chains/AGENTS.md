# Credential Chains

Scope: how long-term IAM keys become usable session credentials, and how hot chains are kept warm. Parent index: [`../../../../AGENTS.md`](../../../../AGENTS.md). Encryption details: [`../../../../packages/backend-data/AGENTS.md`](../../../../packages/backend-data/AGENTS.md). The walk itself: [`assume-role/AGENTS.md`](../assume-role/AGENTS.md).

## Storage

Long-term IAM keys live AES-GCM-encrypted in D1 (`CredentialsDAO`, an `EncryptedDAO`), one row per
principal ARN. A `credential.assumed_by` value makes that row an intermediate hop pointing at the
row it may assume, so the chain is the relation itself — there is no separate chain table.
`principalArns` is ordered **target → base** (`principalArns[0]` is the role being reached, the last
entry is the base IAM user), and `CredentialsDAO.getCredentialChainByPrincipalArn` is the single
walk that produces it.

Relationships are managed through `POST|DELETE /user/admin/credentials/relationship`; access grants
through `POST|DELETE /user/admin/access`. Those are different things: a relationship says _this
principal may assume that one_, a grant says _this user may assume that role_.

Per encrypted surface the key chain is resolved by
`backend-services/composition/encryptionKeys.ts` and **injected** into the services, which is what
keeps a service from building a second scope. `CREDENTIAL_ENCRYPTION_KEY_SECRET` covers the D1
table; `CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET` covers the KV namespace. Each chain holds that one
key; the legacy single `AES_ENCRYPTION_KEY_SECRET` and its read fallback were removed once every row
was rewritten. The DAOs still accept a longer chain, so a future rotation can append the outgoing
key.

`AwsAccountsDAO` holds account nicknames; `RoleConfigsDAO` holds the per-role session duration and
Console destination path/region.

## Depth is bounded, and the bound is the chain's

`PRINCIPAL_TRUST_CHAIN_LIMIT` (default 3) bounds how many principals a chain may have. A chain
longer than that is **refused** — `InternalServerError`, with the walk logged at `error` — whether
it is warm or cold, and whether it is walked by `CredentialsDAO.getCredentialChainByPrincipalArn`
(the cron and the collection tasks) or by
`CredentialChainService.getCredentialChainToFirstCachedPrincipal` (the interactive path). The
credential walk still answers a single-hop request with `ForbiddenError`, because long-term keys are
deliberately not retrievable; that refusal is about _what_ a chain yields, not how deep it is.

Both walks decide this the same way, and that is the part worth not breaking. The check is
"did the walk stop with `assumed_by` still set?", evaluated on its own — **not** folded into the
key check below it. An operator can store credentials for any principal ARN
(`POST /user/admin/credentials`), mid-chain ones included, so whether the row a walk stops on
happens to carry keys says nothing about whether the chain is over-long. Reading it that way is how
a four-principal chain came to be served as a silent three-hop prefix: no error, no log, and the
`exceeds the maximum allowed depth` line unreachable.

**The cache must not decide this.** `getCredentialChainToFirstCachedPrincipal` skips the cache at
the boundary position — the last one the budget reaches — because that hop is exactly the one whose
successor is unknown, and returning on a hit there answers "the chain is fine" without asking. A
warm entry there made the answer depend on cache warmth: the same chain was refused cold and served
warm. Every position below the boundary still short-circuits, and still costs no extra row read,
which is what keeps the fix free on the hot path; only the rejected case pays for the extra read.

The bound is the `throw` inside the loop, not a term in the `while` condition. A counter incremented
in the condition drifts out of step with the counter the check reads — which is how "the limit was
hit" came to mean both "the chain ended here" and "we ran out of budget" depending on which line you
read. It is also what still terminates a cyclic `assumed_by` relation.

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

**Only a principal that sits in a chain is registered.** `credential_cache_config` gets a row from
`storeCredentialRelationship` — the role whose `assumed_by` points somewhere — and not from
`storeCredential`. A base IAM principal's chain has length 1, and `getCredentialChain` answers a
length-1 chain with `ForbiddenError` ("long-term credentials are not retrievable"), so registering
those meant the batch consisted entirely of rows that could only ever fail, each occupying the front
of `ORDER BY last_cached_at`. A length-1 chain arriving here anyway is skipped quietly rather than
counted as a failure.

`last_cached_at` is stamped on **failure** as well as success, for the same reason: a row that
always throws would otherwise sort first forever and starve every principal behind it. The error is
still logged and counted in `itemsFailed` — the stamp is about scheduling, not about pretending.

**An over-long chain counts as a failure, deliberately, and unlike the length-1 skip above.** There
is nothing to warm for a chain that must not be served, so it fails every cycle and stays visible in
the maintenance tab until someone raises `PRINCIPAL_TRUST_CHAIN_LIMIT` or shortens the chain. That is
the intended reading: it is an operator-actionable misconfiguration, not the scheduling noise the
`ForbiddenError` skip exists to absorb. Quietly skipping it would leave the deep principal with no
pre-warm and no signal that anything is wrong with it.

Each principal is isolated in its own `try`: one unresolvable chain — a credentials row deleted out
from under a stale `credential_cache_config` entry — must not abort the remaining principals.

Regression test: `test/integration/api/CredentialPrewarm.int.test.ts` (real D1 and KV, stubbed
STS).

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
