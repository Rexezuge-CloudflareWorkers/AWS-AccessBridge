import { DatabaseError } from '@aws-access-bridge/backend-errors';
import type { UserAccessTokenInternal } from '@aws-access-bridge/shared/model';
import { UserAccessTokenMetadata } from '@aws-access-bridge/shared/model/UserAccessToken';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';

class UserAccessTokenDAO {
  protected readonly database: D1Database | D1DatabaseSession;

  constructor(database: D1Database | D1DatabaseSession) {
    this.database = database;
  }

  public async create(tokenId: string, userEmail: string, token: string, name: string, expiresAt: number): Promise<void> {
    const createdAt: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const result: D1Result = await this.database
      .prepare(
        'INSERT INTO user_access_tokens (token_id, user_email, access_token, name, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(tokenId, userEmail, token, name, createdAt, expiresAt)
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
        `SELECT token_id, user_email, access_token, name, created_at, expires_at, last_used_at FROM user_access_tokens WHERE token_id = ? ${activeFilter} LIMIT 1`,
      )
      .bind(...bindings)
      .first<UserAccessTokenInternal>();
    if (result) {
      return {
        tokenId: result.token_id,
        userEmail: result.user_email,
        name: result.name,
        createdAt: result.created_at,
        expiresAt: result.expires_at,
        lastUsedAt: result.last_used_at,
      };
    }
    return undefined;
  }

  public async getByToken(token: string, activeOnly: boolean): Promise<UserAccessTokenMetadata | undefined> {
    const currentTime: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const activeFilter: string = activeOnly ? 'AND expires_at > ?' : '';
    const bindings: unknown[] = activeOnly ? [token, currentTime] : [token];
    const result: UserAccessTokenInternal | null = await this.database
      .prepare(
        `SELECT token_id, user_email, access_token, name, created_at, expires_at, last_used_at FROM user_access_tokens WHERE access_token = ? ${activeFilter} LIMIT 1`,
      )
      .bind(...bindings)
      .first<UserAccessTokenInternal>();
    if (result) {
      return {
        tokenId: result.token_id,
        userEmail: result.user_email,
        name: result.name,
        createdAt: result.created_at,
        expiresAt: result.expires_at,
        lastUsedAt: result.last_used_at,
      };
    }
    return undefined;
  }

  public async getByUserEmail(userEmail: string): Promise<UserAccessTokenMetadata[]> {
    const results: UserAccessTokenInternal[] = await this.database
      .prepare('SELECT token_id, user_email, name, created_at, expires_at, last_used_at FROM user_access_tokens WHERE user_email = ?')
      .bind(userEmail)
      .all<UserAccessTokenInternal>()
      .then((result) => result.results);
    return results.map((row) => ({
      tokenId: row.token_id,
      userEmail: row.user_email,
      name: row.name,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
    }));
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

  public async delete(tokenId: string, userEmail: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare('DELETE FROM user_access_tokens WHERE token_id = ? AND user_email = ?')
      .bind(tokenId, userEmail)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to delete access token: ${result.error}`);
    }
  }
}

export { UserAccessTokenDAO };
