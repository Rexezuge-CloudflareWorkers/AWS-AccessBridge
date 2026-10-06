import { DatabaseError } from '@aws-access-bridge/backend-errors';
import type { UserMetadataInternal } from '@aws-access-bridge/shared/model';
import { isMissingSchemaError } from '../utils/D1ErrorClassifier';
import { BaseDAO } from './BaseDAO';

import { assertD1Success } from '../utils/D1Utils';
/**
 * A row of `user_metadata`, including the identity columns added by migration
 * 0032. `user_email` is the frozen anchor and `current_email` the mutable
 * sign-in address; both are absent on a database that predates 0032, which is
 * why the read paths below fall back rather than assume.
 */
interface UserMetadataIdentityInternal extends UserMetadataInternal {
  id?: string | null;
  current_email?: string | null;
}

class UserMetadataDAO extends BaseDAO {
  /**
   * Mint a new opaque account id. `randomblob` is the same source migration
   * 0032 uses for the backfill, so ids minted here and ids minted by the
   * migration are indistinguishable in shape.
   */
  public static newId(): string {
    return `usr_${crypto.randomUUID().replaceAll('-', '')}`;
  }

  /**
   * Provision an account if it does not exist, stamping the 0032 identity
   * columns in the same statement.
   *
   * The identity columns cannot be left to a later backfill: a row created after
   * the migration is never backfilled again, so an account provisioned here
   * without an id would be permanently unresolvable — and its tokens, grants
   * and memberships would carry a NULL `user_id` that fails the foreign keys
   * added alongside them.
   */
  public async ensureUserEmailExists(userEmail: string): Promise<void> {
    const id: string = UserMetadataDAO.newId();
    let result: D1Result;
    try {
      result = await this.database
        .prepare('INSERT OR IGNORE INTO user_metadata (user_email, id, current_email) VALUES (?, ?, ?)')
        .bind(userEmail, id, userEmail.toLowerCase())
        .run();
    } catch (error) {
      // Pre-0032 database: the identity columns do not exist yet, and the
      // address alone is still a complete identity there.
      if (!isMissingSchemaError(error)) throw error;
      result = await this.database
        .prepare('INSERT OR IGNORE INTO user_metadata (user_email) VALUES (?)')
        .bind(userEmail)
        .run();
    }
    assertD1Success(result, `ensure user email exists`);
  }

  /**
   * Account behind a stable id. The inverse of the address lookups, for
   * callers that already hold a key (a token, a team membership) and need the
   * address the account signs in with today.
   */
  public async getById(userId: string): Promise<UserMetadataIdentityInternal | null> {
    return this.database
      .prepare('SELECT user_email, id, current_email FROM user_metadata WHERE id = ? LIMIT 1')
      .bind(userId)
      .first<UserMetadataIdentityInternal>();
  }

  /**
   * Account by its mutable sign-in address. 0032-only: `current_email` is the
   * column that moves, so this is what survives a change of address.
   */
  public async getByCurrentEmail(currentEmail: string): Promise<UserMetadataIdentityInternal | null> {
    return this.database
      .prepare('SELECT user_email, id, current_email FROM user_metadata WHERE current_email = ? LIMIT 1')
      .bind(currentEmail.toLowerCase())
      .first<UserMetadataIdentityInternal>();
  }

  /**
   * Account by its frozen anchor — the pre-0032 identity, and the only lookup
   * that works on a database which has not applied 0032 at all. Exact match, to
   * mirror the case-sensitive foreign keys the anchor still backs.
   */
  public async getByAnchor(anchorEmail: string): Promise<UserMetadataIdentityInternal | null> {
    return this.database
      .prepare('SELECT user_email, id, current_email FROM user_metadata WHERE user_email = ? LIMIT 1')
      .bind(anchorEmail)
      .first<UserMetadataIdentityInternal>();
  }

  public async setCurrentEmail(userId: string, currentEmail: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare('UPDATE user_metadata SET current_email = ? WHERE id = ?')
      .bind(currentEmail.toLowerCase(), userId)
      .run();
    assertD1Success(result, `set current email`);
  }

  public async isSuperAdmin(userEmail: string): Promise<boolean> {
    const result: UserMetadataInternal | null = await this.database
      .prepare('SELECT is_superadmin FROM user_metadata WHERE user_email = ?')
      .bind(userEmail)
      .first<UserMetadataInternal>();
    // SQLite stores booleans as integers; normalize 0/1 to boolean.
    return Boolean(result?.is_superadmin ?? false);
  }

  public async getPreferredLanguage(userEmail: string): Promise<string | null> {
    const result: UserMetadataInternal | null = await this.database
      .prepare('SELECT preferred_language FROM user_metadata WHERE user_email = ?')
      .bind(userEmail)
      .first<UserMetadataInternal>();
    return result?.preferred_language ?? null;
  }

  public async updatePreferredLanguage(userEmail: string, preferredLanguage: string | null): Promise<void> {
    const result: D1Result = await this.database
      .prepare('UPDATE user_metadata SET preferred_language = ? WHERE user_email = ?')
      .bind(preferredLanguage, userEmail)
      .run();
    assertD1Success(result, `update preferred language`);
  }

  public async getOrCreateFederationUsername(userEmail: string): Promise<string> {
    const result: UserMetadataInternal | null = await this.database
      .prepare('SELECT federation_username FROM user_metadata WHERE user_email = ?')
      .bind(userEmail)
      .first<UserMetadataInternal>();
    if (result?.federation_username) {
      return result.federation_username;
    }
    const federationUsername: string = crypto.randomUUID().replaceAll('-', '').toUpperCase();
    // `ensureUserEmailExists` first, because the INSERT below has to stamp the
    // 0032 identity columns: a row created here without `id`/`current_email` is
    // never backfilled again, so the account would be permanently unresolvable
    // (`current_email IS NULL`, `id IS NULL`) and its rows would carry a NULL
    // `user_id` that fails the foreign keys added alongside them. D1 does not
    // enforce foreign keys by default, so an `assumable_roles` row can exist with
    // no metadata row at all and this path then becomes the first writer.
    await this.ensureUserEmailExists(userEmail);
    // INSERT rather than UPDATE: callers that reach here before any other
    // metadata write (e.g. token creation) have no row yet, and an UPDATE would
    // match nothing — the generated name would be returned but never persisted,
    // handing the user a different STS RoleSessionName on every assume-role and
    // defeating CloudTrail correlation. ON CONFLICT keeps concurrent callers on
    // the single stored value rather than racing to overwrite it.
    const insertResult: D1Result = await this.database
      .prepare('UPDATE user_metadata SET federation_username = COALESCE(federation_username, ?) WHERE user_email = ?')
      .bind(federationUsername, userEmail)
      .run();
    if (!insertResult.success) {
      throw new DatabaseError(`Failed to store federation username: ${insertResult.error}`);
    }
    // Re-read rather than returning the candidate: under a concurrent insert
    // another caller may have won, and their value is now the stored one.
    const stored: UserMetadataInternal | null = await this.database
      .prepare('SELECT federation_username FROM user_metadata WHERE user_email = ?')
      .bind(userEmail)
      .first<UserMetadataInternal>();
    return stored?.federation_username ?? federationUsername;
  }
}

export { UserMetadataDAO };
export type { UserMetadataIdentityInternal };
