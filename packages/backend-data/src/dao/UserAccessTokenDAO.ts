import { DatabaseError } from '@aws-access-bridge/backend-errors';
import type { UserAccessTokenInternal } from '@aws-access-bridge/shared/model';
import { UserAccessTokenMetadata } from '@aws-access-bridge/shared/model/UserAccessToken';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import { ownerClause } from './AssumableRolesQueries';
import { BaseDAO } from './BaseDAO';

class UserAccessTokenDAO extends BaseDAO {
  public async create(
    tokenId: string,
    userEmail: string,
    token: string,
    name: string,
    expiresAt: number,
    userId: string | null = null,
  ): Promise<void> {
    const createdAt: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const result: D1Result = await this.database
      .prepare(
        'INSERT INTO user_access_tokens (token_id, user_email, access_token, name, created_at, expires_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(tokenId, userEmail, token, name, createdAt, expiresAt, userId)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to create access token: ${result.error}`);
    }
  }

  public async getById(tokenId: string, activeOnly: boolean): Promise<UserAccessTokenMetadata | undefined> {
    const currentTime: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const activeFilter: string = activeOnly ? 'AND expires_at > ?' : '';
    const bindings: unknown[] = activeOnly ? [tokenId, currentTime] : [tokenId];
    const result: UserAccessTokenInternal | null = await this.database
      .prepare(
        `SELECT token_id, user_email, user_id, access_token, name, created_at, expires_at, last_used_at FROM user_access_tokens WHERE token_id = ? ${activeFilter} LIMIT 1`,
      )
      .bind(...bindings)
      .first<UserAccessTokenInternal>();
    if (result) {
      return {
        tokenId: result.token_id,
        userEmail: result.user_email,
        userId: result.user_id ?? null,
        name: result.name,
        createdAt: result.created_at,
        expiresAt: result.expires_at,
        lastUsedAt: result.last_used_at,
      };
    }
    return undefined;
  }

  /**
   * The PAT authentication read. Carries `user_id` so the caller can resolve the
   * owner's CURRENT address rather than reporting the token's stored anchor —
   * without it, a token minted before an address change would keep
   * authenticating as the old address forever.
   */
  public async getByToken(token: string, activeOnly: boolean): Promise<UserAccessTokenMetadata | undefined> {
    const currentTime: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const activeFilter: string = activeOnly ? 'AND expires_at > ?' : '';
    const bindings: unknown[] = activeOnly ? [token, currentTime] : [token];
    const result: UserAccessTokenInternal | null = await this.database
      .prepare(
        `SELECT token_id, user_email, user_id, access_token, name, created_at, expires_at, last_used_at FROM user_access_tokens WHERE access_token = ? ${activeFilter} LIMIT 1`,
      )
      .bind(...bindings)
      .first<UserAccessTokenInternal>();
    if (result) {
      return {
        tokenId: result.token_id,
        userEmail: result.user_email,
        userId: result.user_id ?? null,
        name: result.name,
        createdAt: result.created_at,
        expiresAt: result.expires_at,
        lastUsedAt: result.last_used_at,
      };
    }
    return undefined;
  }

  /**
   * Tokens owned by an account id.
   *
   * The id-keyed read; `getByUserEmail` below is the pre-0032 fallback for a
   * caller that could not resolve an id. The `user_id = ? OR user_email = ?`
   * shape matters: a row written before 0032 has `user_id IS NULL`, and
   * dropping the address clause would make such a token invisible to its owner.
   */
  public async getByUserId(userId: string, anchorEmail: string): Promise<UserAccessTokenMetadata[]> {
    const results: UserAccessTokenInternal[] = await this.database
      .prepare(
        `SELECT token_id, user_email, user_id, name, created_at, expires_at, last_used_at
         FROM user_access_tokens
         WHERE user_id = ? OR (user_id IS NULL AND user_email = ?)`,
      )
      .bind(userId, anchorEmail)
      .all<UserAccessTokenInternal>()
      .then((result) => result.results);
    return results.map((row) => ({
      tokenId: row.token_id,
      userEmail: row.user_email,
      userId: row.user_id ?? null,
      name: row.name,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
    }));
  }

  public async getByUserEmail(userEmail: string): Promise<UserAccessTokenMetadata[]> {
    const results: UserAccessTokenInternal[] = await this.database
      .prepare(
        'SELECT token_id, user_email, user_id, name, created_at, expires_at, last_used_at FROM user_access_tokens WHERE user_email = ?',
      )
      .bind(userEmail)
      .all<UserAccessTokenInternal>()
      .then((result) => result.results);
    return results.map((row) => ({
      tokenId: row.token_id,
      userEmail: row.user_email,
      userId: row.user_id ?? null,
      name: row.name,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
    }));
  }

  /**
   * Count only tokens that still authenticate. Used for the per-user quota:
   * counting expired rows let a user who let every token lapse be permanently
   * refused new ones, since nothing prunes `user_access_tokens` in the
   * background.
   */
  public async countActiveByUserEmail(userEmail: string): Promise<number> {
    const result = await this.database
      .prepare('SELECT COUNT(*) as total FROM user_access_tokens WHERE user_email = ? AND expires_at > ?')
      .bind(userEmail, TimestampUtil.getCurrentUnixTimestampInSeconds())
      .first<{ total: number }>();
    return result?.total ?? 0;
  }

  /**
   * Quota count for an account id. The `user_id IS NULL` clause is what stops a
   * token the 0032 backfill could not attribute from escaping the quota — the
   * alternative is a user who can mint past the cap by holding unattributed
   * rows.
   */
  public async countActiveByUserId(userId: string, anchorEmail: string): Promise<number> {
    const result = await this.database
      .prepare(
        `SELECT COUNT(*) as total FROM user_access_tokens
         WHERE (user_id = ? OR (user_id IS NULL AND user_email = ?)) AND expires_at > ?`,
      )
      .bind(userId, anchorEmail, TimestampUtil.getCurrentUnixTimestampInSeconds())
      .first<{ total: number }>();
    return result?.total ?? 0;
  }

  public async updateLastUsedById(tokenId: string): Promise<void> {
    const lastUsedAt: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const result: D1Result = await this.database
      .prepare('UPDATE user_access_tokens SET last_used_at = ? WHERE token_id = ?')
      .bind(lastUsedAt, tokenId)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to update last used: ${result.error}`);
    }
  }

  public async updateLastUsedByToken(token: string): Promise<void> {
    const lastUsedAt: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const result: D1Result = await this.database
      .prepare('UPDATE user_access_tokens SET last_used_at = ? WHERE access_token = ?')
      .bind(lastUsedAt, token)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to update last used: ${result.error}`);
    }
  }

  /**
   * Delete a token, asserting ownership.
   *
   * The ownership check is a security control, not a convenience filter, so it
   * matches on the id when the caller resolved one and falls back to the anchor
   * for a token written before 0032. The `user_id IS NULL` guard on the address
   * arm is load-bearing: without it, an address that one account has moved off
   * but which still sits in another account's legacy column would let the wrong
   * caller delete the token.
   */
  public async delete(tokenId: string, anchorEmail: string, userId: string | null = null): Promise<void> {
    // A null id narrows to the address arm on its own; a resolved id gets the
    // shared `ownerClause`. Aliased to this table so the shared predicate — the
    // `user_id IS NULL` guard this security control depends on — has a single
    // definition without an empty alias leaking `.user_id` into the SQL.
    const ownership: string = userId === null ? `user_access_tokens.user_id IS NULL AND user_access_tokens.user_email = ?` : ownerClause('user_access_tokens');
    const bindings: unknown[] = userId === null ? [tokenId, anchorEmail] : [tokenId, userId, anchorEmail];
    const result: D1Result = await this.database
      .prepare(`DELETE FROM user_access_tokens WHERE token_id = ? AND ${ownership}`)
      .bind(...bindings)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to delete access token: ${result.error}`);
    }
  }
}

export { UserAccessTokenDAO };
