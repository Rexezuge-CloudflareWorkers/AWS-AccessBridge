# Assume-Role Flows

Scope: the browser, programmatic and federate surfaces, and the chain walk they share. Parent index: [`../../../../AGENTS.md`](../../../../AGENTS.md). Service map: [`../../../../packages/backend-services/AGENTS.md`](../../../../packages/backend-services/AGENTS.md).

## Three surfaces, two route classes

| Route                                              | Auth                                      |
| -------------------------------------------------- | ----------------------------------------- |
| `POST /user/aws/assume-role`                       | Cloudflare Access                         |
| `POST /api/aws/assume-role`                        | Bearer PAT or HMAC-signed internal call   |
| `POST /user/aws/console` · `POST /api/aws/console` | as above; `ConsoleService.getSigninToken` |
| `GET /user/aws/federate` · `GET /api/aws/federate` | as above; composes both in process        |

The `/user/aws/*` and `/api/aws/*` paths register **the same route classes** (`apps/api/src/endpoints/api/aws/`). Federate no longer loops back over the `SELF` binding: `FederationService` composes `AssumeRoleService.assumeRoleForUser` and `ConsoleService` directly, so one federation is one audit entry instead of three and the credentials never touch the network stack. See [`../../../../apps/api/AGENTS.md`](../../../../apps/api/AGENTS.md).

## The order the walk happens in

`AssumeRoleService.assumeRoleForUser` does, in this order:

1. **Resolve the owner.** `resolveOwner(identity, userEmail)` → `{userId, anchorEmail}`.
2. **Access check.** `AssumableRolesDAO.verifyUserHasAccessToRole` for the account id and role name parsed out of the ARN — _before_ any credential work, so an unauthorised request never causes an assume-role.
3. **Read the role config** for the per-role session duration.
4. **Build the chain**, but only as far as the first cached principal — `CredentialChainService.getCredentialChainToFirstCachedPrincipal`. A warm intermediate hop is returned directly, so a warm chain skips the base credentials entirely.
5. **Mint the session name** from the account's federation username, looked up by **anchor**. Reading the current address here would return a session name for a row that does not exist and change the STS `RoleSessionName`.
6. **Walk the chain** from `startIndex` down to 0, assuming each hop in turn.

In `AssumeRoleService`, the parameter named `userId` in `assumeRoleChain` is the STS `RoleSessionName`, **not** the account id.

## An intermediate hop is cached only when it is usable

`assumeRoleChain` writes a cache entry for an intermediate role (`i > 0`) only when the returned credentials carry **both** an expiration and a session token. An entry with an expiration but no session token is unusable: the read path short-circuits on a hit and would hand it straight back to STS, which rejects it. Skipping the write just means the next walk re-derives that hop.

Neither end of the chain is cacheable: `principalArns[0]` is the **target** role (its credentials are returned to the caller, not stored) and the last entry is the **base IAM user** (long-term keys, never stored — the read path throws `ForbiddenError`, "long-term credentials are not retrievable", rather than return them).

## Chain length

`CredentialChainService.getTrustChainLimit` reads `PRINCIPAL_TRUST_CHAIN_LIMIT` (default 3), bounding how many principals a chain may have. A longer chain is refused once the walk reaches the boundary hop — the last position the budget allows, which is never served from cache, so the interactive and cron walks agree. The one residual is an entry cached under a higher limit: it short-circuits below the new boundary until it ages out with its credentials. See [`credential-chains/AGENTS.md`](../credential-chains/AGENTS.md) for the boundary rule and why the cache is skipped there.

## Validation and discovery

- `POST /user/admin/credentials/validate` → `CredentialStoreService.validateCredentials`, which calls `StsService.validateCredentials` (`GetCallerIdentity`) on the submitted key directly.
- `POST /user/admin/credentials/test-chain` → `CredentialChainService.testChain`, which walks base → target assuming each hop and returns the per-step result.
- `POST /user/admin/account/roles` → `AccountService.listAccountRoles` → `IamService.listRoles` (`iam:ListRoles`). The assumed role frequently lacks that permission; the UI degrades to manual ARN entry rather than failing, so this is an optional capability, not a requirement.

What consumes a leaf credential: [`resource-inventory/AGENTS.md`](../resource-inventory/AGENTS.md).
