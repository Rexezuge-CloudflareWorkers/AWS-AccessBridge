-- Migration 0032: Decouple the user identifier from the email address.
--
-- Before this migration `user_metadata.user_email` was the PRIMARY KEY *and* the
-- identity key of every user-keyed table, so the address was the account. It
-- could not be changed: three tables carry live
-- `FOREIGN KEY (user_email) REFERENCES user_metadata(user_email)`
-- (`assumable_roles`, `user_favorite_accounts`, and `user_access_tokens`, the
-- last with `ON DELETE CASCADE`), so rewriting an address either tripped the
-- constraint or cascaded the user's tokens out of the database. Every grant,
-- favourite, team membership and token in the system keys off that string.
--
-- After this migration:
--   * `user_metadata.id` is the stable account key (opaque `usr_<hex>`).
--   * `user_metadata.current_email` is the mutable sign-in address.
--   * `user_metadata.user_email` becomes the frozen *anchor* address. It is
--     never updated, so every existing foreign key and every existing
--     `*_email` value keeps resolving forever, and no table is rebuilt.
--   * `user_emails` is the address registry: an address maps to an account,
--     `is_verified = 1` means "may be used to log in". A changed-from address
--     is retained at `0` so rows written before the change stay attributable
--     while the address stops authenticating, and it is released for
--     re-registration by a later account.
--   * Every user-keyed table carries a `user_id` FK to `user_metadata(id)` and
--     is read and written by that id. The legacy `user_email` / `created_by`
--     string columns stay as denormalized copies: still written, no longer the
--     identity.
--
-- Why the address stays in `user_metadata` at all: D1 enforces foreign keys
-- through the Worker binding and honours neither `PRAGMA foreign_keys = off`
-- nor `PRAGMA legacy_alter_table = on` (both verified against real D1 — see
-- `test/integration/api/UserIdentityUpgrade.int.test.ts`). `defer_foreign_keys`
-- is honoured but D1 documents that it does not suppress `ON DELETE CASCADE`.
-- Since SQLite rewrites a child's foreign key clause when the parent is renamed,
-- and drops a parent by cascading, the three references to
-- `user_metadata(user_email)` cannot be repointed without losing rows. Keeping
-- `user_email` as a frozen anchor sidesteps the rebuild entirely: this
-- migration is purely additive.
--
-- Rerunnable: every backfill is guarded by `IS NULL`, and `id` is only filled
-- where it is still missing.

-- ============================================================
-- Phase 1: stable account key
-- ============================================================
-- SQLite cannot add a PRIMARY KEY column, so the id is a plain column with a
-- unique index. A unique index is a valid foreign key parent, which is all the
-- `user_id` references below need.
ALTER TABLE user_metadata ADD COLUMN id TEXT;

UPDATE user_metadata SET id = 'usr_' || lower(hex(randomblob(16))) WHERE id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_metadata_id ON user_metadata(id);

-- ============================================================
-- Phase 2: mutable login address
-- ============================================================
-- `user_email` stays as the frozen anchor (see the header note); `current_email`
-- is what the account signs in with and what the API reports.
--
-- Case handling. Unlike the system this replaces, nothing normalized an address
-- on the way in: the Cloudflare Access JWT's `email` claim is written verbatim,
-- and `user_metadata.user_email` is a case-SENSITIVE primary key. A live
-- database can therefore legitimately hold both `Alice@x.com` and
-- `alice@x.com` as two separate accounts. Lowercasing unconditionally would
-- make the uniqueness index below fail and abort the migration, and collapsing
-- the pair in `user_emails` would silently re-point one account's grants at the
-- other.
--
-- So a normalized address is assigned only where it is unambiguous. The
-- case-variant stragglers keep `current_email IS NULL`, get no registry row, and
-- continue to resolve through their exact-case anchor — byte-for-byte today's
-- behaviour. They stay visible to ops via `user_metadata.current_email IS NULL`
-- and can be merged deliberately once a merge route exists.
--
-- Two rows are only ever both assigned when their `lower()` differ, so the
-- unique index provably succeeds (and NULLs are distinct in a SQLite unique
-- index, so the unassigned rows cannot collide either).
ALTER TABLE user_metadata ADD COLUMN current_email TEXT;

UPDATE user_metadata
SET current_email = lower(user_email)
WHERE current_email IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_metadata other
    WHERE other.user_email <> user_metadata.user_email
      AND lower(other.user_email) = lower(user_metadata.user_email)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_metadata_current_email ON user_metadata(current_email);

-- ============================================================
-- Phase 3: address registry
-- ============================================================
-- Login resolution consults `is_verified = 1` only. Backfilled from every
-- account that was assigned a `current_email` above, which is the normalized
-- form of its frozen anchor.
CREATE TABLE IF NOT EXISTS user_emails (
  email TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_metadata(id) ON DELETE CASCADE,
  is_verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_emails_user ON user_emails(user_id);

INSERT OR IGNORE INTO user_emails (email, user_id, is_verified, created_at)
SELECT current_email, id, 1, strftime('%s', 'now')
FROM user_metadata
WHERE current_email IS NOT NULL;

-- ============================================================
-- Phase 4: user_id on every user-keyed table
-- ============================================================
-- Additive only: `ALTER TABLE ... ADD COLUMN`, then a backfill.
--
-- The backfill resolves through `user_metadata` on the *exact* anchor — the
-- same comparison the pre-existing foreign keys perform — and requires
-- `current_email IS NOT NULL`. That combination can only ever reproduce the
-- mapping which already exists: an address that resolves to no account, or one
-- of the ambiguous stragglers above, leaves `user_id` NULL rather than being
-- attributed to a neighbour. Those rows keep their string column and the DAOs
-- fall back to the `*_email` read, which is how an unknown actor stays
-- attributable instead of breaking the query.

-- --- access / authority ---
-- These decide permissions, so they carry a unique `(scope, user_id)` index:
-- the DAOs retarget their upserts onto it, and a NULL id never collides
-- because NULLs are distinct in a SQLite unique index. The pre-existing
-- primary keys on `user_email` are left in place, so an address that predates
-- this migration keeps deduplicating exactly as it did before.
ALTER TABLE assumable_roles ADD COLUMN user_id TEXT REFERENCES user_metadata(id);
UPDATE assumable_roles SET user_id = (
  SELECT um.id FROM user_metadata um
  WHERE um.user_email = assumable_roles.user_email AND um.current_email IS NOT NULL
  LIMIT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assumable_roles_user_key
  ON assumable_roles(user_id, aws_account_id, role_name);
CREATE INDEX IF NOT EXISTS idx_assumable_roles_user_id ON assumable_roles(user_id);

ALTER TABLE user_favorite_accounts ADD COLUMN user_id TEXT REFERENCES user_metadata(id);
UPDATE user_favorite_accounts SET user_id = (
  SELECT um.id FROM user_metadata um
  WHERE um.user_email = user_favorite_accounts.user_email AND um.current_email IS NOT NULL
  LIMIT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_favorites_user_key
  ON user_favorite_accounts(user_id, aws_account_id);

ALTER TABLE user_access_tokens ADD COLUMN user_id TEXT REFERENCES user_metadata(id);
UPDATE user_access_tokens SET user_id = (
  SELECT um.id FROM user_metadata um
  WHERE um.user_email = user_access_tokens.user_email AND um.current_email IS NOT NULL
  LIMIT 1
);
CREATE INDEX IF NOT EXISTS idx_tokens_user_id ON user_access_tokens(user_id);

ALTER TABLE team_members ADD COLUMN user_id TEXT REFERENCES user_metadata(id);
UPDATE team_members SET user_id = (
  SELECT um.id FROM user_metadata um
  WHERE um.user_email = team_members.user_email AND um.current_email IS NOT NULL
  LIMIT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_team_user ON team_members(team_id, user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);

-- --- attribution ---
-- The frozen string stays in place so audits and history read the same; the id
-- is what identity-keyed filtering uses, so an actor is still the same account
-- after re-addressing.
ALTER TABLE audit_logs ADD COLUMN user_id TEXT REFERENCES user_metadata(id);
UPDATE audit_logs SET user_id = (
  SELECT um.id FROM user_metadata um
  WHERE um.user_email = audit_logs.user_email AND um.current_email IS NOT NULL
  LIMIT 1
);
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs(user_id, timestamp DESC);

-- --- pure attribution, never a lookup key ---
-- `teams.created_by` and `spend_alerts.created_by` are written but never used
-- as a predicate anywhere, and `teams` seeds a `'system'` sentinel that matches
-- no account, so these stay nullable and resolve to NULL for it.
ALTER TABLE teams ADD COLUMN created_by_user_id TEXT REFERENCES user_metadata(id);
UPDATE teams SET created_by_user_id = (
  SELECT um.id FROM user_metadata um
  WHERE um.user_email = teams.created_by AND um.current_email IS NOT NULL
  LIMIT 1
);
CREATE INDEX IF NOT EXISTS idx_teams_created_by_user_id ON teams(created_by_user_id);

ALTER TABLE spend_alerts ADD COLUMN created_by_user_id TEXT REFERENCES user_metadata(id);
UPDATE spend_alerts SET created_by_user_id = (
  SELECT um.id FROM user_metadata um
  WHERE um.user_email = spend_alerts.created_by AND um.current_email IS NOT NULL
  LIMIT 1
);
CREATE INDEX IF NOT EXISTS idx_spend_alerts_created_by_user_id ON spend_alerts(created_by_user_id);

-- ============================================================
-- Phase 5: verify
-- ============================================================
-- Every backfill above resolved through `user_metadata` on the exact anchor, so
-- no foreign key should be dangling. `PRAGMA foreign_key_check` reports
-- violations as rows rather than raising, so
-- `UserIdentityUpgrade.int.test.ts` asserts it comes back empty against a
-- seeded database.
PRAGMA foreign_key_check;
