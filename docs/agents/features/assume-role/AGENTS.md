# Assume-Role Flows

Scope: the browser, programmatic and federate surfaces, and the chain walk they share. Parent index: [`../../../../AGENTS.md`](../../../../AGENTS.md). Service map: [`../../../../packages/backend-services/AGENTS.md`](../../../../packages/backend-services/AGENTS.md).

## Three surfaces, two route classes

| Route                                              | Auth                                         |
| -------------------------------------------------- | -------------------------------------------- |
| `POST /user/aws/assume-role`                       | Cloudflare Access                            |
| `POST /api/aws/assume-role`                        | Bearer PAT or HMAC-signed internal self-call |
| `POST /user/aws/console` · `POST /api/aws/console` | as above; `ConsoleService.getSigninToken`    |
| `GET /user/aws/federate` · `GET /api/aws/federate` | as above; composes both in process           |

The `/user/aws/*` and `/api/aws/*` paths register **the same route classes**
(`apps/api/src/endpoints/api/aws/`). Federate used to be able to reach the programmatic pair
because it looped back over the `SELF` service binding through `InternalRequestHelper`,
HMAC-signing each call so the inner request authenticated as the same user without a PAT. It does
not any more: `FederationService` composes `AssumeRoleService.assumeRoleForUser` and
`ConsoleService` directly, so one federation is one audit entry instead of three and the temporary
credentials never touch the network stack. Nothing in `apps/` or `packages/` produces an
HMAC-signed self-call any more — the verification half (`hmacValidation`, `ReplayGuard`,
`INTERNAL_REQUEST_HMAC_SECRET`) stays so a holder of the secret can still call `/api/*`, and
`InternalRequestHelper` stays exported from `backend-services/aws/` as the signer for such a
caller, but it has no in-repo consumer. See [`../../../apps/api/AGENTS.md`](../../../apps/api/AGENTS.md).

## The order the walk happens in

`AssumeRoleService.assumeRoleForUser` does, in this order:

1. **Access check.** `AssumableRolesDAO.verifyUserHasAccessToRole` for the account id and role name
   parsed out of the ARN. This runs _before_ any credential work, so an unauthorised request never
   causes an assume-role.
2. **Resolve the owner.** `resolveOwner(identity, userEmail)` → `{userId, anchorEmail}`.
3. **Read the role config** for the per-role session duration.
4. **Build the chain**, but only as far as the first cached principal —
   `CredentialChainService.getCredentialChainToFirstCachedPrincipal`. That walk returns cached
   credentials directly if an intermediate hop is warm, so a warm chain skips the base credentials
   entirely.
5. **Mint the session name** from the account's federation username, looked up by **anchor**.
   Reading the current address here instead would return a session name for a row that does not
   exist and change the STS `RoleSessionName`.
6. **Walk the chain** from `startIndex` down to 0, assuming each hop in turn.

In `AssumeRoleService`, the parameter named `userId` in `assumeRoleChain` is the STS
`RoleSessionName`, **not** the account id.

## An intermediate hop is cached only when it is usable

`assumeRoleChain` writes a cache entry for an intermediate role (`i > 0`) only when the returned
credentials carry **both** an expiration and a session token. An entry with an expiration but no
session token is unusable: the read path short-circuits on a hit and would hand it straight back to
STS, which rejects it. Skipping the write just means the next walk re-derives that hop.

Neither end of the chain is cacheable: `principalArns[0]` is the **target** role (whose credentials
are returned to the caller, not stored) and the last entry is the **base IAM user** (long-term keys,
never stored — `getCredentialChainToFirstCachedPrincipal` throws `ForbiddenError` rather than return
them, with the message "long-term credentials are not retrievable").

## Chain length

`CredentialChainService.getTrustChainLimit` reads `PRINCIPAL_TRUST_CHAIN_LIMIT` (default 3), and it
bounds how many principals a chain may have. A chain longer than that is refused outright — this is
not a walking budget that a warm cache can spend differently, and `assumeRoleChain` never sees such a
chain. The interactive walk and the cron walk must agree on that, or the answer depends on whether
the chain happens to be warm.

See [`credential-chains/AGENTS.md`](../credential-chains/AGENTS.md) for the boundary rule itself, the
walk's shape and why the cache is skipped at the boundary; [`resource-inventory/AGENTS.md`](../resource-inventory/AGENTS.md)
for what consumes a leaf.

## Validation and discovery

- `POST /user/admin/credentials/validate` → `CredentialStoreService.validateCredentials`, which
  calls `StsService.validateCredentials` (`GetCallerIdentity`) on the submitted key directly.
- `POST /user/admin/credentials/test-chain` → `CredentialChainService.testChain`, which walks
  base → target assuming each hop and returns the per-step result.
- `POST /user/admin/account/roles` → `AccountService.listAccountRoles` → `IamService.listRoles`
  (`iam:ListRoles`). The assumed role frequently lacks that permission; the UI degrades to manual
  ARN entry rather than failing, so this is an optional capability, not a requirement.
