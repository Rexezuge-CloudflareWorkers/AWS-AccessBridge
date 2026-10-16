# User Identity

Scope: the decoupled account key, the frozen email anchor, the address registry, and changing a sign-in address. Parent index: [`../../../../AGENTS.md`](../../../../AGENTS.md). Service code: [`../../../../packages/backend-services/AGENTS.md`](../../../../packages/backend-services/AGENTS.md). Schema rationale: [`../../../../packages/backend-data/AGENTS.md`](../../../../packages/backend-data/AGENTS.md). Apply notes: [`../../runtime/AGENTS.md`](../../runtime/AGENTS.md).

## Model

| Thing           | Where                            | Role                                                                        |
| --------------- | -------------------------------- | --------------------------------------------------------------------------- |
| `user_email`    | `user_metadata.user_email`       | Frozen **anchor**. Primary key, never updated, target of live FKs.          |
| `id`            | `user_metadata.id` (`usr_<hex>`) | Stable account key. Every user-keyed table's `user_id` points here.         |
| `current_email` | `user_metadata.current_email`    | Mutable sign-in address. `NULL` on pre-0032 rows and unresolved stragglers. |
| registry        | `user_emails`                    | Address → account. `is_verified = 1` may authenticate.                      |

Two addresses per account, deliberately: the anchor is what the legacy `*_email` columns and their foreign keys hold (so nothing is rebuilt), and `current_email` is what the user signs in with. Reads and writes for grants, favourites, memberships and tokens key on `id`, which is what makes an address change non-destructive.

## Why the anchor is frozen

D1 enforces foreign keys through the Worker binding and honours neither `PRAGMA foreign_keys = off` nor `PRAGMA legacy_alter_table = on` (verified against real D1 in `test/integration/api/UserIdentityUpgrade.int.test.ts`), and SQLite rewrites a child's FK clause when the parent is renamed. Three live references (`assumable_roles`, `user_favorite_accounts`, `user_access_tokens` — the last `ON DELETE CASCADE`) therefore cannot be repointed without losing rows, so `0032` is purely additive.

## Resolution

`UserIdentityService` (`packages/backend-services/src/identity/`), one memoized instance per request scope:

1. `user_emails`, looked up with the address **lowercased**. A row that is `is_verified = 0` **does not resolve** — otherwise a reassigned company address would inherit the previous holder's account.
2. `user_metadata.current_email`.
3. The frozen anchor — the pre-0032 floor — and only when the row's `current_email` is `NULL` or equal to the address presented.

Two rules are load-bearing. The registry lookup lowercases because registry rows are _stored_ lowercased: an exact-match lookup let a mixed-case address (`Alice@x.com`) miss the registry and keep resolving for an account that had since moved — a revoked address keeping its access. And `findByAnchor` rejects a row whose `current_email` differs, because "the anchor" is a floor for accounts that have never moved, not a permanent alias for one that has. Every write targets the resolved **anchor**, never the presented address; routes, the OpenAPI document and the web client stay address-based.

## Changing an address

Service method `UserIdentityService.setPrimaryEmail`, ops script `scripts/ops/change-email.ts` (same claim → move → revoke sequence). Claiming before revoking is the safety property: a brief dual-auth window, never a lockout. **No route exposes this yet** — Cloudflare Access is the only authenticator, so a self-service change needs a proof-of-control confirm step performed while authenticated as the _new_ address. Until then, the ops script is the only supported path.

## Case-variant accounts

`0032` assigns `current_email` only where the lowercased address is unambiguous. A live database can hold both `Alice@x.com` and `alice@x.com` (the PK is case-sensitive and nothing normalized on the way in), and those rows are left with `current_email IS NULL` — merging them would hand one account's grants to the other, and normalizing unconditionally would abort the migration on the unique index. Find them with:

```sql
SELECT user_email FROM user_metadata WHERE current_email IS NULL;
```

They still authenticate via their anchor. Merge them deliberately before any address change (`scripts/ops/change-email.ts` refuses an account with no `id`).

## `@rexezuge/identity` is NOT adopted, and the reason is the schema

The kit's `UserDAO` reads a **`users`** table; this repository's identity anchor lives in **`user_metadata`** (from `0032`), with `user_emails` as the registry under the name both implementations agree on. So adopting the kit's DAOs is a data migration, and SQLite makes it a **three-release arc**:

1. **Expand** — `0035_kit_users_expand.sql` creates `users`; every writer dual-writes, readers still read `user_metadata`.
2. **Adopt** — `UserIdentityService` and `AddressRegistryService` read `users`; `accountLookup` takes over from `resolveOwner`.
3. **Contract** — drop `user_metadata`'s identity columns and the dual-write.

It cannot be one migration: SQLite cannot `ALTER` a primary key or change a `REFERENCES` clause, and D1 honours neither `foreign_keys=off` nor `legacy_alter_table`, so the new table must exist alongside the old one for at least one deploy between any two states. **Until that arc lands, `@rexezuge/identity` is not a dependency** — it was declared while the adoption was scoped and removed once nothing imported it.

### What the kit's fixes mean for the local copies

Two identity hardening changes landed in the kit at 1.8.0; both are already present in this repository's copies, so there is no exposure — but the reasons are worth keeping:

- **`UserEmailDAO.register` is a conditional upsert.** `ON CONFLICT(email) DO UPDATE … WHERE user_emails.is_verified = 0`, with `meta.changes` as the verdict. Without the `WHERE`, a claim racing a revoke re-points a _verified_ address at a new account — an identity takeover.
- **`accountLookup.resolveAccount` refuses a moved anchor.** An account whose `current_email` has since changed resolves to `null` rather than to the address it used to sign in with, so a stale cached lookup cannot authenticate the wrong person.
