import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations, migrationFileNames } from '../helpers/migrations';

/**
 * The 0032 user-identity upgrade, run against a POPULATED database.
 *
 * The claim under test is the one that matters for a live deployment: the
 * migration is purely additive, so applying it to a database that already has
 * grants, favourites, tokens, memberships and attribution rows loses nothing,
 * leaves every pre-existing foreign key intact, and backfills the identity
 * columns correctly — including for a mixed-case address and for a
 * case-variant pair, which must NOT be merged.
 *
 * The harness applies one migration file per `db.batch()`-free statement and
 * supports a `{to}` range, which is what makes "apply everything up to 0031,
 * seed, then apply 0032" expressible.
 */

const LAST_PRE_IDENTITY_MIGRATION = '0031_distinct_credential_ivs.sql';
const IDENTITY_MIGRATION = '0032_user_identity.sql';

const ALICE = 'alice@legacy.test';
const BOB = 'BOB@LEGACY.TEST';
const AMBIGUOUS_UPPER = 'Case@variant.test';
const AMBIGUOUS_LOWER = 'case@variant.test';
const UNKNOWN = 'ghost@unknown.test';

const ACCOUNT_A = '111111111111';
const ACCOUNT_B = '222222222222';

type Db = D1Database;

/**
 * Tables seeded before the upgrade; the counts must survive it exactly.
 *
 * `audit_logs` is absent because a later test appends a row to it, which would
 * make a final-count comparison order-dependent. It is asserted against its
 * post-migration count instead.
 */
const GUARDED_TABLES = [
  'user_metadata',
  'aws_accounts',
  'assumable_roles',
  'user_favorite_accounts',
  'user_access_tokens',
  'team_members',
  'teams',
  'spend_alerts',
] as const;

const NOW = 1_700_000_000;

async function run(db: Db, sql: string, ...bindings: unknown[]): Promise<void> {
  const result = await db
    .prepare(sql)
    .bind(...bindings)
    .run();
  expect(result.success, `seed failed: ${sql.slice(0, 80)}`).toBe(true);
}

async function snapshotCounts(db: Db): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of GUARDED_TABLES) {
    const row = await db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first<{ c: number }>();
    counts[table] = row?.c ?? 0;
  }
  return counts;
}

async function seedLegacyDatabase(db: Db): Promise<void> {
  // One account per case, including a mixed-case address and a case-variant
  // pair. The pair is the interesting one: it is two accounts today, and the
  // migration must leave them two.
  await run(db, `INSERT INTO user_metadata (user_email, is_superadmin, federation_username) VALUES (?, 1, 'ALICEFED')`, ALICE);
  await run(db, `INSERT INTO user_metadata (user_email, is_superadmin, federation_username) VALUES (?, 0, 'BOBFED')`, BOB);
  await run(db, `INSERT INTO user_metadata (user_email, is_superadmin, federation_username) VALUES (?, 0, 'UPPER')`, AMBIGUOUS_UPPER);
  await run(db, `INSERT INTO user_metadata (user_email, is_superadmin, federation_username) VALUES (?, 0, 'LOWER')`, AMBIGUOUS_LOWER);

  await run(db, `INSERT INTO aws_accounts (aws_account_id, aws_account_nickname) VALUES (?, 'Prod')`, ACCOUNT_A);
  await run(db, `INSERT INTO aws_accounts (aws_account_id, aws_account_nickname) VALUES (?, 'Dev')`, ACCOUNT_B);

  // Grants. Bob's is stored MIXED-CASE relative to nothing, but the join in the
  // backfill must still land on his id.
  await run(db, `INSERT INTO assumable_roles (user_email, aws_account_id, role_name) VALUES (?, ?, 'Admin')`, ALICE, ACCOUNT_A);
  await run(db, `INSERT INTO assumable_roles (user_email, aws_account_id, role_name) VALUES (?, ?, 'Dev')`, BOB, ACCOUNT_B);
  await run(db, `INSERT INTO assumable_roles (user_email, aws_account_id, role_name) VALUES (?, ?, 'Revoked')`, AMBIGUOUS_UPPER, ACCOUNT_B);

  await run(db, `INSERT INTO user_favorite_accounts (user_email, aws_account_id) VALUES (?, ?)`, ALICE, ACCOUNT_A);
  await run(db, `INSERT INTO user_favorite_accounts (user_email, aws_account_id) VALUES (?, ?)`, AMBIGUOUS_LOWER, ACCOUNT_A);

  await run(
    db,
    `INSERT INTO user_access_tokens (token_id, user_email, access_token, name, created_at, expires_at) VALUES (?, ?, 'tok-alice', 'alice token', ?, ?)`,
    'tid-alice',
    ALICE,
    NOW,
    NOW + 86_400,
  );
  await run(
    db,
    `INSERT INTO user_access_tokens (token_id, user_email, access_token, name, created_at, expires_at) VALUES (?, ?, 'tok-bob', 'bob token', ?, ?)`,
    'tid-bob',
    BOB,
    NOW,
    NOW + 86_400,
  );

  await run(db, `INSERT INTO teams (team_id, team_name, created_at, created_by) VALUES ('t1', 'Ops', ?, ?)`, NOW, ALICE);
  await run(db, `INSERT INTO teams (team_id, team_name, created_at, created_by) VALUES ('t2', 'Ghost', ?, 'system')`, NOW);
  await run(db, `INSERT INTO team_members (team_id, user_email, role, joined_at) VALUES ('t1', ?, 'admin', ?)`, ALICE, NOW);
  await run(db, `INSERT INTO team_members (team_id, user_email, role, joined_at) VALUES ('t1', ?, 'member', ?)`, BOB, NOW);

  await run(
    db,
    `INSERT INTO audit_logs (log_id, timestamp, user_email, action, method, path, status_code) VALUES ('l1', ?, ?, 'GET_CURRENT_USER', 'GET', '/user/me', 200)`,
    NOW,
    ALICE,
  );
  await run(
    db,
    `INSERT INTO audit_logs (log_id, timestamp, user_email, action, method, path, status_code) VALUES ('l2', ?, ?, 'GET_CURRENT_USER', 'GET', '/user/me', 200)`,
    NOW,
    BOB,
  );

  await run(
    db,
    `INSERT INTO spend_alerts (alert_id, aws_account_id, threshold_amount, period_type, created_by, created_at) VALUES ('a1', ?, 10, 'monthly', ?, ?)`,
    ACCOUNT_A,
    ALICE,
    NOW,
  );
}

async function userIdFor(db: Db, userEmail: string): Promise<string | null> {
  const row = await db.prepare('SELECT id FROM user_metadata WHERE user_email = ?').bind(userEmail).first<{ id: string | null }>();
  return row?.id ?? null;
}

describe('0032 user identity upgrade on a populated database', () => {
  let db: Db;
  let before: Record<string, number>;
  let after: Record<string, number>;

  beforeAll(async () => {
    db = env.AccessBridgeDB as unknown as Db;
    expect(migrationFileNames()).toContain(LAST_PRE_IDENTITY_MIGRATION);
    expect(migrationFileNames()).toContain(IDENTITY_MIGRATION);

    // Legacy schema first, then the upgrade under test.
    await applyMigrations(db, { to: LAST_PRE_IDENTITY_MIGRATION });
    await seedLegacyDatabase(db);
    before = await snapshotCounts(db);

    // A pre-0032 row has no id: that is the shape being upgraded.
    const preUser = await db.prepare('SELECT * FROM user_metadata WHERE user_email = ?').bind(ALICE).first<Record<string, unknown>>();
    expect(preUser?.id).toBeUndefined();
    expect(preUser?.current_email).toBeUndefined();

    await applyMigrations(db, { from: IDENTITY_MIGRATION });
    after = await snapshotCounts(db);
    // `audit_logs` is excluded from GUARDED_TABLES, so record it here while the
    // database still holds only the seeded rows.
    after['audit_logs'] = ((await db.prepare('SELECT COUNT(*) AS c FROM audit_logs').first<{ c: number }>())?.c) ?? 0;
    before['audit_logs'] = 2;
  });

  it('loses no rows in any table the upgrade touches', () => {
    const diffs: string[] = [];
    for (const table of GUARDED_TABLES) {
      if (before[table] !== after[table]) diffs.push(`${table}: ${before[table]} -> ${after[table]}`);
    }
    expect(diffs).toEqual([]);
    // And the seed was actually there, so "no loss" is not vacuously true.
    expect(after['assumable_roles']).toBe(3);
    expect(after['user_access_tokens']).toBe(2);
    expect(after['team_members']).toBe(2);
    expect(after['spend_alerts']).toBe(1);
  });

  it('reports no foreign key violations after the upgrade', async () => {
    const violations = await db.prepare('PRAGMA foreign_key_check').all<Record<string, unknown>>();
    expect(violations.results ?? []).toEqual([]);
  });

  it('leaves every pre-existing foreign key intact', async () => {
    // The frozen-anchor design exists because D1 will not let these be
    // repointed: it honours neither `PRAGMA foreign_keys = off` nor
    // `PRAGMA legacy_alter_table = on`, and `defer_foreign_keys` does not
    // suppress `ON DELETE CASCADE`. `user_metadata.user_email` therefore stays
    // the primary key, so no existing reference could have been invalidated.
    for (const table of ['assumable_roles', 'user_favorite_accounts', 'user_access_tokens']) {
      const fks = await db.prepare(`PRAGMA foreign_key_list('${table}')`).all<{ table: string; to: string }>();
      const targets = (fks.results ?? []).filter((fk) => fk.table === 'user_metadata').map((fk) => fk.to);
      // The frozen anchor reference survives *and* the new id reference is added
      // alongside it, so each table is now guarded on both.
      expect(`${table}: ${JSON.stringify(targets)}`).toBe(`${table}: ["user_email","id"]`);
    }
    const meta = await db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_metadata'`).first<{ sql: string }>();
    expect(meta?.sql).toContain('user_email VARCHAR(120) PRIMARY KEY');
    expect(meta?.sql).toContain('id TEXT');
    expect(meta?.sql).toContain('current_email TEXT');
  });

  it('gives every account a unique id', async () => {
    const rows = await db.prepare('SELECT id FROM user_metadata').all<{ id: string }>();
    const ids = (rows.results ?? []).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^usr_[0-9a-f]{32}$/);
    }
  });

  it('normalizes the login address where it is unambiguous', async () => {
    // Alice and Bob are each the only holder of their address, so both get the
    // normalized form — including Bob, who was stored mixed-case.
    const alice = await db.prepare('SELECT user_email, current_email FROM user_metadata WHERE user_email = ?').bind(ALICE).first<{
      user_email: string;
      current_email: string;
    }>();
    expect(alice?.user_email).toBe(ALICE);
    expect(alice?.current_email).toBe(ALICE);

    const bob = await db.prepare('SELECT user_email, current_email FROM user_metadata WHERE user_email = ?').bind(BOB).first<{
      user_email: string;
      current_email: string;
    }>();
    expect(bob?.user_email).toBe(BOB);
    expect(bob?.current_email).toBe(BOB.toLowerCase());
  });

  // The load-bearing safety property: a case-variant pair stays two accounts.
  // Merging them would hand one user's grants to the other, and lowercasing
  // unconditionally would abort the migration outright.
  it('leaves a case-variant pair unresolved rather than merging or failing', async () => {
    const rows = await db
      .prepare(
        `SELECT user_email, current_email FROM user_metadata
         WHERE user_email IN (?, ?) ORDER BY user_email`,
      )
      .bind(AMBIGUOUS_UPPER, AMBIGUOUS_LOWER)
      .all<{ user_email: string; current_email: string | null }>();
    expect(rows.results).toHaveLength(2);
    for (const row of rows.results ?? []) {
      expect(row.current_email).toBeNull();
    }
    // Neither is in the registry, so neither can authenticate yet, and the
    // unique index on current_email still has room for them.
    const registry = await db
      .prepare('SELECT COUNT(*) AS c FROM user_emails WHERE email IN (?, ?)')
      .bind(AMBIGUOUS_UPPER, AMBIGUOUS_LOWER)
      .first<{ c: number }>();
    expect(registry?.c).toBe(0);

    // The unique index is genuinely there, not merely unviolated.
    const indexes = await db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'user_metadata'`)
      .all<{ name: string }>();
    const names = (indexes.results ?? []).map((i) => i.name);
    expect(names).toContain('idx_user_metadata_current_email');
    expect(names).toContain('idx_user_metadata_id');
  });

  it('backfills a verified registry row for each unambiguous account', async () => {
    const registry = await db.prepare('SELECT email, user_id, is_verified FROM user_emails ORDER BY email').all<{
      email: string;
      user_id: string;
      is_verified: number;
    }>();
    // Alice + Bob only. The two stragglers are deliberately absent.
    expect(registry.results).toHaveLength(2);
    for (const row of registry.results ?? []) {
      expect(row.email).toBe(row.email.toLowerCase());
      expect(row.is_verified).toBe(1);
      expect(row.user_id).toMatch(/^usr_/);
    }
    expect(registry.results?.map((r) => r.email).sort()).toEqual([ALICE, BOB.toLowerCase()].sort());
  });

  it('backfills user_id on access-control rows, resolving the exact anchor', async () => {
    const aliceId = await userIdFor(db, ALICE);
    const bobId = await userIdFor(db, BOB);
    expect(aliceId).toBeTruthy();
    expect(bobId).toBeTruthy();
    expect(aliceId).not.toBe(bobId);

    const aliceGrant = await db
      .prepare('SELECT user_id FROM assumable_roles WHERE user_email = ? AND role_name = ?')
      .bind(ALICE, 'Admin')
      .first<{ user_id: string | null }>();
    expect(aliceGrant?.user_id).toBe(aliceId);

    // Bob was stored `BOB@LEGACY.TEST`; the backfill must still land on him.
    const bobGrant = await db
      .prepare('SELECT user_id FROM assumable_roles WHERE user_email = ? AND role_name = ?')
      .bind(BOB, 'Dev')
      .first<{ user_id: string | null }>();
    expect(bobGrant?.user_id).toBe(bobId);
  });

  // `assumable_roles` and `user_favorite_accounts` carry a live foreign key to
  // `user_metadata(user_email)`, so in practice an unattributable actor cannot
  // exist there — the constraint prevents it. The case-variant pair is the
  // realistic unattributed case, and it is the one the migration must not
  // resolve: attributing the straggler's grant to a neighbour would be a
  // privilege escalation.
  it('leaves user_id NULL for an account 0032 could not resolve', async () => {
    const orphan = await db
      .prepare('SELECT user_id FROM assumable_roles WHERE user_email = ?')
      .bind(AMBIGUOUS_UPPER)
      .first<{ user_id: string | null }>();
    expect(orphan?.user_id).toBeNull();
    // And it is still readable by its address, so the row is not lost.
    const stillThere = await db
      .prepare('SELECT role_name FROM assumable_roles WHERE user_email = ?')
      .bind(AMBIGUOUS_UPPER)
      .first<{ role_name: string }>();
    expect(stillThere?.role_name).toBe('Revoked');

    const fav = await db
      .prepare('SELECT user_id FROM user_favorite_accounts WHERE user_email = ?')
      .bind(AMBIGUOUS_LOWER)
      .first<{ user_id: string | null }>();
    expect(fav?.user_id).toBeNull();
  });

  // `audit_logs` has no foreign key, so an unknown actor genuinely can appear
  // there — the 0032 backfill must leave it NULL and keep the entry.
  it('leaves user_id NULL in audit_logs for an actor that matches no account', async () => {
    await run(
      db,
      `INSERT INTO audit_logs (log_id, timestamp, user_email, action, method, path, status_code) VALUES ('l3', ?, ?, 'GET_CURRENT_USER', 'GET', '/user/me', 200)`,
      NOW,
      UNKNOWN,
    );
    const row = await db.prepare('SELECT user_id, user_email FROM audit_logs WHERE log_id = ?').bind('l3').first<{
      user_id: string | null;
      user_email: string;
    }>();
    expect(row?.user_id).toBeNull();
    expect(row?.user_email).toBe(UNKNOWN);
  });

  it('backfills user_id on favourites, tokens, memberships and attribution', async () => {
    const aliceId = await userIdFor(db, ALICE);
    const bobId = await userIdFor(db, BOB);

    const fav = await db
      .prepare('SELECT user_id FROM user_favorite_accounts WHERE user_email = ?')
      .bind(ALICE)
      .first<{ user_id: string | null }>();
    expect(fav?.user_id).toBe(aliceId);

    const token = await db.prepare('SELECT user_id FROM user_access_tokens WHERE token_id = ?').bind('tid-bob').first<{
      user_id: string | null;
    }>();
    expect(token?.user_id).toBe(bobId);

    const member = await db.prepare('SELECT user_id FROM team_members WHERE user_email = ?').bind(ALICE).first<{
      user_id: string | null;
    }>();
    expect(member?.user_id).toBe(aliceId);

    const audit = await db.prepare('SELECT user_id FROM audit_logs WHERE log_id = ?').bind('l1').first<{ user_id: string | null }>();
    expect(audit?.user_id).toBe(aliceId);

    const alert = await db.prepare('SELECT created_by_user_id FROM spend_alerts WHERE alert_id = ?').bind('a1').first<{
      created_by_user_id: string | null;
    }>();
    expect(alert?.created_by_user_id).toBe(aliceId);

    const team = await db.prepare('SELECT created_by_user_id FROM teams WHERE team_id = ?').bind('t1').first<{
      created_by_user_id: string | null;
    }>();
    expect(team?.created_by_user_id).toBe(aliceId);
  });

  // `teams.created_by` seeds a 'system' sentinel that matches no account, so
  // the attribution column must tolerate NULL.
  it('leaves created_by_user_id NULL for the system sentinel', async () => {
    const team = await db.prepare('SELECT created_by_user_id FROM teams WHERE team_id = ?').bind('t2').first<{
      created_by_user_id: string | null;
    }>();
    expect(team?.created_by_user_id).toBeNull();
  });

  it('keeps the ON DELETE CASCADE from user_access_tokens intact', async () => {
    const fks = await db
      .prepare(`PRAGMA foreign_key_list('user_access_tokens')`)
      .all<{ table: string; from: string; to: string; on_delete: string }>();
    const cascade = (fks.results ?? []).find((fk) => fk.from === 'user_email' && fk.to === 'user_email');
    expect(cascade?.on_delete).toBe('CASCADE');
  });

  it('creates the id-keyed unique indexes the DAOs upsert onto', async () => {
    for (const [table, expected] of [
      ['assumable_roles', 'idx_assumable_roles_user_key'],
      ['user_favorite_accounts', 'idx_user_favorites_user_key'],
      ['team_members', 'idx_team_members_team_user'],
    ] as const) {
      const row = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`).bind(expected).first<{
        name: string;
      }>();
      expect(`${table}:${row?.name}`).toBe(`${table}:${expected}`);
    }
  });

  // The end-to-end point of the whole change: moving the address leaves the
  // account's grants, favourites, membership and tokens intact, because they
  // are keyed on the id and not the string.
  it('keeps id-keyed access working after the login address changes', async () => {
    const aliceId = await userIdFor(db, ALICE);
    const now = Math.floor(Date.now() / 1000);

    // The same claim -> move -> revoke sequence the service performs.
    await run(
      db,
      `INSERT INTO user_emails (email, user_id, is_verified, created_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id, is_verified = excluded.is_verified`,
      'alice@new.test',
      aliceId as string,
      now,
    );
    await run(db, `UPDATE user_metadata SET current_email = ? WHERE id = ?`, 'alice@new.test', aliceId as string);
    await run(db, `UPDATE user_emails SET is_verified = 0 WHERE user_id = ? AND email != ?`, aliceId as string, 'alice@new.test');

    // The anchor is untouched, so the FK targets still resolve...
    const anchor = await db.prepare('SELECT user_email FROM user_metadata WHERE id = ?').bind(aliceId as string).first<{
      user_email: string;
    }>();
    expect(anchor?.user_email).toBe(ALICE);

    // ...and the id-keyed reads all still return Alice's rows.
    const byId = await db
      .prepare('SELECT COUNT(*) AS c FROM assumable_roles WHERE user_id = ?')
      .bind(aliceId as string)
      .first<{ c: number }>();
    expect(byId?.c).toBe(1);

    const tokensById = await db
      .prepare('SELECT COUNT(*) AS c FROM user_access_tokens WHERE user_id = ?')
      .bind(aliceId as string)
      .first<{ c: number }>();
    expect(tokensById?.c).toBe(1);

    // The new address resolves to the same account; the old one no longer does.
    const viaNew = await db.prepare('SELECT user_id FROM user_emails WHERE email = ? AND is_verified = 1').bind('alice@new.test').first<{
      user_id: string;
    }>();
    expect(viaNew?.user_id).toBe(aliceId);
    const viaOld = await db.prepare('SELECT is_verified FROM user_emails WHERE email = ?').bind(ALICE).first<{ is_verified: number }>();
    expect(viaOld?.is_verified).toBe(0);

    // And the anchor is what the legacy foreign-keyed column still holds.
    const tokenRow = await db.prepare('SELECT user_email, user_id FROM user_access_tokens WHERE token_id = ?').bind('tid-alice').first<{
      user_email: string;
      user_id: string;
    }>();
    expect(tokenRow?.user_email).toBe(ALICE);
    expect(tokenRow?.user_id).toBe(aliceId);
  });
});
