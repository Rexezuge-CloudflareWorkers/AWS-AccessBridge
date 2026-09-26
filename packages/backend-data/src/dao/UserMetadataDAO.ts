import { DatabaseError } from '@aws-access-bridge/backend-errors';
import type { UserMetadataInternal } from '@aws-access-bridge/shared/model';
import { BaseDAO } from './BaseDAO';

class UserMetadataDAO extends BaseDAO {
  public async ensureUserEmailExists(userEmail: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare('INSERT OR IGNORE INTO user_metadata (user_email) VALUES (?)')
      .bind(userEmail)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to ensure user email exists: ${result.error}`);
    }
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
    if (!result.success) {
      throw new DatabaseError(`Failed to update preferred language: ${result.error}`);
    }
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
    // INSERT rather than UPDATE: callers that reach here before any other
    // metadata write (e.g. token creation) have no row yet, and an UPDATE would
    // match nothing — the generated name would be returned but never persisted,
    // handing the user a different STS RoleSessionName on every assume-role and
    // defeating CloudTrail correlation. ON CONFLICT keeps concurrent callers on
    // the single stored value rather than racing to overwrite it.
    const insertResult: D1Result = await this.database
      .prepare('INSERT INTO user_metadata (user_email, federation_username) VALUES (?, ?) ON CONFLICT(user_email) DO UPDATE SET federation_username = COALESCE(user_metadata.federation_username, excluded.federation_username)')
      .bind(userEmail, federationUsername)
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
