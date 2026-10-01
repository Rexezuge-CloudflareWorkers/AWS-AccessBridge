import type { RoleConfig, RoleConfigInternal } from '@aws-access-bridge/shared/model';
import { BaseDAO } from './BaseDAO';
import { ORPHANED_BY_ASSUMABLE_ROLES } from './AwsAccountsDAO';

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
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT OR REPLACE INTO role_configs (aws_account_id, role_name, destination_path, destination_region, role_session_duration_seconds) VALUES (?, ?, ?, ?, ?)',
          )
          .bind(awsAccountId, roleName, destinationPath || null, destinationRegion || null, roleSessionDurationSeconds ?? null)
          .run(),
      'set role config',
    );
  }

  public async deleteRoleConfig(awsAccountId: string, roleName: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('DELETE FROM role_configs WHERE aws_account_id = ? AND role_name = ?')
          .bind(awsAccountId, roleName)
          .run(),
      'delete role config',
    );
  }

  public async deleteOrphaned(): Promise<number> {
    const result: D1Result = await this.deleteOrphanedRows('role_configs', ORPHANED_BY_ASSUMABLE_ROLES);
    return result.meta?.changes ?? 0;
  }
}

export { RoleConfigsDAO };
