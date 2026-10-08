import { BaseDAO } from './BaseDAO';

import { assertD1Success } from '../utils/D1Utils';
/**
 * One known address for an account.
 *
 * `is_verified` gates login: `1` means the address may authenticate the
 * account, `0` means it was changed away from and is retained only so rows
 * written before the change still resolve. The revoked row is re-pointed (not
 * deleted) when a later account legitimately claims the address, so an address
 * is never permanently reserved.
 */
interface UserEmailRow {
  email: string;
  user_id: string;
  is_verified: number;
  created_at: number;
}

class UserEmailDAO extends BaseDAO {
  /**
   * Claim an address for an account.
   *
   * An existing verified row is left alone: the address already belongs to
   * someone, and silently re-pointing it would hand one account's identity to
   * another. The `'already-claimed'` return is the check — callers reject on it.
   * An unverified (revoked) row is re-pointed, which releases the address.
   */
  public async register(input: {
    email: string;
    userId: string;
    isVerified: boolean;
    now: number;
  }): Promise<'claimed' | 'already-claimed'> {
    const email: string = input.email.toLowerCase();
    const existing: UserEmailRow | null = await this.get(email);
    if (existing && existing.is_verified === 1) return 'already-claimed';
    // Conditional update: the DO UPDATE may only re-point an UNVERIFIED row.
    // Without `WHERE is_verified = 0`, two concurrent claims — claim and
    // revoke — could re-point a verified address at a new account, because
    // the `existing` read above and this write are not one statement. The
    // `meta.changes` check turns "lost the race" into `'already-claimed'`.
    const result: D1Result = await this.database
      .prepare(
        `INSERT INTO user_emails (email, user_id, is_verified, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id, is_verified = excluded.is_verified
         WHERE user_emails.is_verified = 0`,
      )
      .bind(email, input.userId, input.isVerified ? 1 : 0, input.now)
      .run();
    assertD1Success(result, `register user email`);
    return (result.meta?.changes ?? 0) === 0 ? 'already-claimed' : 'claimed';
  }

  /**
   * Lookup by exact stored address. Deliberately case-SENSITIVE: the registry
   * stores the normalized address, and migration 0032 never lowercases at
   * resolution time. A pre-0032 mixed-case account has no registry row, so
   * there is nothing here for it to collide with — it falls through to the
   * anchor lookup in `UserIdentityService` instead.
   */
  public async get(email: string): Promise<UserEmailRow | null> {
    return this.database.prepare('SELECT * FROM user_emails WHERE email = ? LIMIT 1').bind(email).first<UserEmailRow>();
  }

  public async listByUserId(userId: string): Promise<UserEmailRow[]> {
    const result: D1Result<UserEmailRow> = await this.database
      .prepare('SELECT * FROM user_emails WHERE user_id = ? ORDER BY is_verified DESC, created_at ASC')
      .bind(userId)
      .all<UserEmailRow>();
    return result.results ?? [];
  }

  /**
   * Revoke every verified address for an account. Used when an account's login
   * address changes, so only the new address can authenticate it.
   */
  public async revokeAllVerified(userId: string, exceptEmail: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare('UPDATE user_emails SET is_verified = 0 WHERE user_id = ? AND email != ?')
      .bind(userId, exceptEmail.toLowerCase())
      .run();
    assertD1Success(result, `revoke verified user emails`);
  }
}

export { UserEmailDAO };
export type { UserEmailRow };
