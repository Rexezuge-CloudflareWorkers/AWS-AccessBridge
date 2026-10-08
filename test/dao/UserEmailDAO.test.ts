import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserEmailDAO } from '@aws-access-bridge/backend-data/dao/UserEmailDAO';
import type { UserEmailRow } from '@aws-access-bridge/backend-data/dao/UserEmailDAO';
import { DatabaseError } from '@aws-access-bridge/backend-errors';

/**
 * `UserEmailDAO` gates which address may authenticate an account, so its claim
 * rules are a security surface rather than bookkeeping. The three cases that
 * matter are all here:
 *
 * - a verified address already belonging to someone else must NOT be
 *   re-pointed (that would hand one account's identity to another),
 * - a *revoked* address must be re-pointable, or an address would stay
 *   permanently reserved after a user moved away from it,
 * - normalization must be case-insensitive, or `Alice@x.com` and `alice@x.com`
 *   would be two independent claims on one identity.
 */
describe('UserEmailDAO', () => {
  let mockDb: D1Database;
  let mockStmt: D1PreparedStatement;

  beforeEach(() => {
    mockStmt = {
      bind: vi.fn().mockReturnThis(),
      // `meta.changes` is how the DAO tells a written row from a lost race.
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({ results: [] }),
      raw: vi.fn(),
    };

    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStmt),
      exec: vi.fn(),
      batch: vi.fn(),
      dump: vi.fn(),
    } as unknown as D1Database;
  });

  function existing(overrides: Partial<UserEmailRow> = {}): UserEmailRow {
    return { email: 'alice@example.com', user_id: 'usr_abc', is_verified: 1, created_at: 1, ...overrides };
  }

  describe('register', () => {
    it('claims a free address', async () => {
      const dao = new UserEmailDAO(mockDb);
      await expect(dao.register({ email: 'Alice@Example.com', userId: 'usr_abc', isVerified: true, now: 100 })).resolves.toBe('claimed');

      expect(mockStmt.bind).toHaveBeenCalledWith('alice@example.com', 'usr_abc', 1, 100);
      // The upsert is what releases a previously-revoked address, and it is
      // conditional: only an UNVERIFIED row may be re-pointed.
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id'));
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE user_emails.is_verified = 0'));
    });

    it('stores is_verified as 0/1 rather than a boolean', async () => {
      const dao = new UserEmailDAO(mockDb);
      await dao.register({ email: 'alice@example.com', userId: 'usr_abc', isVerified: false, now: 100 });
      expect(mockStmt.bind).toHaveBeenCalledWith('alice@example.com', 'usr_abc', 0, 100);
    });

    it('refuses to re-point an address another account already holds', async () => {
      // The core safety property. Silently re-pointing would let one account
      // authenticate as another the moment the address was claimed.
      vi.mocked(mockStmt.first).mockResolvedValue(existing({ user_id: 'usr_other' }));
      const dao = new UserEmailDAO(mockDb);

      await expect(dao.register({ email: 'alice@example.com', userId: 'usr_new', isVerified: true, now: 100 })).resolves.toBe(
        'already-claimed',
      );

      // No write at all — not merely a write that is later rolled back.
      expect(mockStmt.run).not.toHaveBeenCalled();
    });

    it('re-points a revoked address, releasing it', async () => {
      // The counterpart: without this, an address a user moved away from could
      // never be claimed by anyone else.
      vi.mocked(mockStmt.first).mockResolvedValue(existing({ is_verified: 0 }));
      const dao = new UserEmailDAO(mockDb);

      await expect(dao.register({ email: 'alice@example.com', userId: 'usr_new', isVerified: true, now: 200 })).resolves.toBe('claimed');

      expect(mockStmt.run).toHaveBeenCalledOnce();
      expect(mockStmt.bind).toHaveBeenCalledWith('alice@example.com', 'usr_new', 1, 200);
    });

    it('lowercases the address it looks up and stores', async () => {
      const dao = new UserEmailDAO(mockDb);
      await dao.register({ email: 'ALICE@EXAMPLE.COM', userId: 'usr_abc', isVerified: true, now: 1 });

      const lookupArgs = vi.mocked(mockStmt.first).mock.calls.length;
      expect(lookupArgs).toBe(1);
      // The read uses the raw email (see `get`'s case-sensitivity note) and the
      // write the normalized one, so the stored key is canonical.
      expect(mockStmt.bind).toHaveBeenCalledWith('alice@example.com', 'usr_abc', 1, 1);
    });

    it('throws DatabaseError when the write resolves unsuccessful', async () => {
      // D1 reports a failed statement as `{success: false}` rather than throwing,
      // so an unchecked write would report a claim that never happened.
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'disk full' } as unknown as D1Result);
      const dao = new UserEmailDAO(mockDb);

      await expect(dao.register({ email: 'alice@example.com', userId: 'usr_abc', isVerified: true, now: 1 })).rejects.toThrow(
        DatabaseError,
      );
      await expect(dao.register({ email: 'alice@example.com', userId: 'usr_abc', isVerified: true, now: 1 })).rejects.toThrow(/disk full/);
    });
  });

  describe('get', () => {
    it('returns the stored row', async () => {
      const row = existing();
      vi.mocked(mockStmt.first).mockResolvedValue(row);
      const dao = new UserEmailDAO(mockDb);

      await expect(dao.get('alice@example.com')).resolves.toEqual(row);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM user_emails WHERE email = ? LIMIT 1'));
    });

    it('returns null when no row matches', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue(null);
      await expect(new UserEmailDAO(mockDb).get('nobody@example.com')).resolves.toBeNull();
    });

    it('does not lowercase the lookup key', async () => {
      // Deliberate: the registry stores normalized addresses, and a pre-0032
      // mixed-case account has no registry row to collide with. Normalizing here
      // would make a case-variant probe match a row it should not.
      vi.mocked(mockStmt.first).mockResolvedValue(null);
      await new UserEmailDAO(mockDb).get('Alice@Example.com');

      expect(mockStmt.bind).toHaveBeenCalledWith('Alice@Example.com');
    });
  });

  describe('listByUserId', () => {
    it('orders verified addresses first, then oldest', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({ results: [existing()] } as never);
      const dao = new UserEmailDAO(mockDb);

      await expect(dao.listByUserId('usr_abc')).resolves.toHaveLength(1);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY is_verified DESC, created_at ASC'));
      expect(mockStmt.bind).toHaveBeenCalledWith('usr_abc');
    });

    it('returns an empty array when D1 reports no results', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({} as never);
      await expect(new UserEmailDAO(mockDb).listByUserId('usr_abc')).resolves.toEqual([]);
    });
  });

  describe('revokeAllVerified', () => {
    it('revokes every address except the one being kept', async () => {
      // The `!=` arm is what leaves the new address able to authenticate after
      // a login-address change.
      const dao = new UserEmailDAO(mockDb);
      await dao.revokeAllVerified('usr_abc', 'New@Example.com');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE user_emails SET is_verified = 0 WHERE user_id = ? AND email != ?'),
      );
      expect(mockStmt.bind).toHaveBeenCalledWith('usr_abc', 'new@example.com');
    });

    it('throws DatabaseError when the update resolves unsuccessful', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'locked' } as unknown as D1Result);
      const dao = new UserEmailDAO(mockDb);

      await expect(dao.revokeAllVerified('usr_abc', 'new@example.com')).rejects.toThrow(DatabaseError);
    });

    it('never revokes the kept address, even in mixed case', async () => {
      await new UserEmailDAO(mockDb).revokeAllVerified('usr_abc', 'NEW@example.com');
      const kept = vi.mocked(mockStmt.bind).mock.calls[0][1];
      // Normalized, so the `!=` comparison cannot be defeated by case.
      expect(kept).toBe('new@example.com');
    });
  });
});
