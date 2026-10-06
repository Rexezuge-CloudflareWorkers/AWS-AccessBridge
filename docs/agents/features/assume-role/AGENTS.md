# Assume-Role Flows

Scope: the browser, programmatic and federate surfaces, and the chain walk they share. Parent index: [`../../../../AGENTS.md`](../../../../AGENTS.md). Service map: [`../../../../packages/backend-services/AGENTS.md`](../../../../packages/backend-services/AGENTS.md).

## Three surfaces, two route classes

| Route                                              | Auth                                         |
| -------------------------------------------------- | -------------------------------------------- |
| `POST /user/aws/assume-role`                       | Cloudflare Access                            |
| `POST /api/aws/assume-role`                        | Bearer PAT or HMAC-signed internal self-call |
| `POST /user/aws/console` · `POST /api/aws/console` | as above; `ConsoleService.getSigninToken`    |
| `GET /user/aws/federate` · `GET /api/aws/federate` | as above; fans out internally                |

The `/user/aws/*` and `/api/aws/*` paths register **the same route classes**
(`apps/api/src/endpoints/api/aws/`). That is why federate, which is a browser entry point, can call
the programmatic pair: it reaches them over the `SELF` service binding through
`InternalRequestHelper`, HMAC-signing each call, so the inner request authenticates as the same
user without a PAT.

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

`CredentialChainService.getTrustChainLimit` reads `PRINCIPAL_TRUST_CHAIN_LIMIT` (default 3). The
walks use `++depth < limit` inside a `do`/`while`, not `<=` — the increment runs in the condition,
so `<=` would admit `limit + 1` hops. `CredentialsDAO.getCredentialChainByPrincipalArn` mirrors that
arithmetic, and the two must agree or the interactive path and the cron path disagree about what a
chain is.

See [`credential-chains/AGENTS.md`](../credential-chains/AGENTS.md) for storage, encryption and the KV
cache; [`resource-inventory/AGENTS.md`](../resource-inventory/AGENTS.md) for what consumes a leaf.

## Validation and discovery

- `POST /user/admin/credentials/validate` → `CredentialStoreService.validateCredentials`, which
  calls `StsService.validateCredentials` (`GetCallerIdentity`) on the submitted key directly.
- `POST /user/admin/credentials/test-chain` → `CredentialChainService.testChain`, which walks
  base → target assuming each hop and returns the per-step result.
- `POST /user/admin/account/roles` → `AccountService.listAccountRoles` → `IamService.listRoles`
  (`iam:ListRoles`). The assumed role frequently lacks that permission; the UI degrades to manual
  ARN entry rather than failing, so this is an optional capability, not a requirement.
