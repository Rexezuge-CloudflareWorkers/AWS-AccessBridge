import { DatabaseError } from '@aws-access-bridge/backend-errors';
import type { RoleConfig, RoleConfigInternal } from '@aws-access-bridge/shared/model';
import { BaseDAO } from './BaseDAO';

class RoleConfigsDAO extends BaseDAO {
  public async getRoleConfig(awsAccountId: string, roleName: string): Promise<RoleConfig | undefined> {
    const result: RoleConfigInternal | null = await this.database
      .prepare(
        'SELECT aws_account_id, role_name, destination_path, destination_region, role_session_duration_seconds FROM role_configs WHERE aws_account_id = ? AND role_name = ?',
      )
      .bind(awsAccountId, roleName)
      .first<RoleConfigInternal>();
    if (result) {
      return {
        awsAccountId: result.aws_account_id,
        roleName: result.role_name,
        destinationPath: result.destination_path,
        destinationRegion: result.destination_region,
        roleSessionDurationSeconds: result.role_session_duration_seconds,
      };
    }
    return undefined;
  }

  public async setRoleConfig(
    awsAccountId: string,
    roleName: string,
    destinationPath?: string,
    destinationRegion?: string,
    roleSessionDurationSeconds?: number,
  ): Promise<void> {
    const result: D1Result = await this.database
      .prepare(
        'INSERT OR REPLACE INTO role_configs (aws_account_id, role_name, destination_path, destination_region, role_session_duration_seconds) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(awsAccountId, roleName, destinationPath || null, destinationRegion || null, roleSessionDurationSeconds ?? null)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to set role config: ${result.error}`);
    }
  }

  public async deleteRoleConfig(awsAccountId: string, roleName: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare('DELETE FROM role_configs WHERE aws_account_id = ? AND role_name = ?')
      .bind(awsAccountId, roleName)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to delete role config: ${result.error}`);
    }
  }

  public async deleteOrphaned(): Promise<number> {
    const result: D1Result = await this.database
      .prepare('DELETE FROM role_configs WHERE aws_account_id NOT IN (SELECT DISTINCT aws_account_id FROM assumable_roles)')
      .run();
    return result.meta?.changes ?? 0;
  }
}

export { RoleConfigsDAO };
