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
    const updateResult: D1Result = await this.database
      .prepare('UPDATE user_metadata SET federation_username = ? WHERE user_email = ?')
      .bind(federationUsername, userEmail)
      .run();
    if (!updateResult.success) {
      throw new DatabaseError(`Failed to update federation username: ${updateResult.error}`);
    }
    return federationUsername;
  }
}

export { UserMetadataDAO };
