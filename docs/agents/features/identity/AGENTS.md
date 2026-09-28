# User Identity

Scope: the decoupled account key, the frozen email anchor, the address registry, and changing a sign-in address. Parent index: `../../../AGENTS.md`. Schema rationale: `../../../packages/backend-data/AGENTS.md`. Apply notes: `../../runtime/AGENTS.md`.

## Model

| Thing           | Where                            | Role                                                                        |
| --------------- | -------------------------------- | --------------------------------------------------------------------------- |
| `user_email`    | `user_metadata.user_email`       | Frozen **anchor**. Primary key, never updated, target of live FKs.          |
| `id`            | `user_metadata.id` (`usr_<hex>`) | Stable account key. Every user-keyed table's `user_id` points here.         |
| `current_email` | `user_metadata.current_email`    | Mutable sign-in address. `NULL` on pre-0032 rows and unresolved stragglers. |
| registry        | `user_emails`                    | Address → account. `is_verified = 1` may authenticate.                      |

Two addresses per account, deliberately: the anchor is what the legacy
`*_email` columns and their foreign keys hold (so nothing is rebuilt), and
`current_email` is what the user signs in with. Reads and writes for grants,
favourites, memberships and tokens key on `id`, which is what makes an address
change non-destructive.

## Why the anchor is frozen

D1 enforces foreign keys through the Worker binding and honours neither
`PRAGMA foreign_keys = off` nor `PRAGMA legacy_alter_table = on` (both verified
against real D1 in `test/integration/api/UserIdentityUpgrade.int.test.ts`).
`defer_foreign_keys` is honoured, but D1 documents that it does not suppress
`ON DELETE CASCADE`, and SQLite rewrites a child's FK clause when the parent is
renamed. Three live references (`assumable_roles`, `user_favorite_accounts`,
`user_access_tokens` — the last `ON DELETE CASCADE`) therefore cannot be
repointed without losing rows, so `0032` is purely additive.

## Resolution

`UserIdentityService` (`packages/backend-services/src/identity/`), one memoized
instance per request scope:

1. `user_emails` exact match. A row that is `is_verified = 0` **does not
   resolve** — otherwise a reassigned company address would inherit the previous
   holder's account.
2. `user_metadata.current_email`.
3. The frozen anchor — the pre-0032 floor, where the address _is_ the identity.

Addresses are matched **exactly**; the migration never lowercases at resolution
time, so a straggler with no registry row cannot be steered into another
account's. Case-insensitivity is enforced where it matters instead — when an
address is claimed.

Services take the caller's sign-in address and resolve internally, so routes,
the OpenAPI document and the web client are unaffected. Every write targets the
resolved **anchor**, never the presented address.

## Changing an address

Service method `UserIdentityService.setPrimaryEmail`, ops script
`scripts/change-email.ts` (same claim → move → revoke sequence). Claiming before
revoking is the safety property: a brief dual-auth window, never a lockout.

**No route exposes this yet.** Cloudflare Access is the only authenticator, so a
self-service change needs a proof-of-control confirm step — performed while
authenticated as the _new_ address — before it can be exposed. Until that lands,
`scripts/change-email.ts` is the only supported path.

## Case-variant accounts

`0032` assigns `current_email` only where the lowercased address is
unambiguous. A live database can hold both `Alice@x.com` and `alice@x.com` (the
PK is case-sensitive and nothing normalized on the way in), and those rows are
left with `current_email IS NULL` — merging them would hand one account's grants
to the other, and normalizing unconditionally would abort the migration on the
unique index. Find them with:

```sql
SELECT user_email FROM user_metadata WHERE current_email IS NULL;
```

They still authenticate via their anchor. Merge them deliberately before any
address change (`scripts/change-email.ts` refuses an account with no `id`).
