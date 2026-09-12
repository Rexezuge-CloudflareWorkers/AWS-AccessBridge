import { DatabaseError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
import type { AssumableAccountsMap } from '@aws-access-bridge/shared/model';

class AssumableRolesDAO {
  protected readonly database: D1Database | D1DatabaseSession;

  constructor(database: D1Database | D1DatabaseSession) {
    this.database = database;
  }

  /**
   * Retrieves a list of role names that the specified user can assume within the given AWS account.
   * @param userEmail The email address of the user.
   * @param awsAccountId The AWS account ID to query roles for.
   * @returns A list of role names the user is authorized to assume in the account.
   */
  public async getRolesByUserAndAccount(userEmail: string, awsAccountId: string): Promise<Array<string>> {
    const results: D1Result<GetRolesByUserAndAccountInternal> = await this.database
      .prepare(
        `SELECT role_name
         FROM assumable_roles
         WHERE user_email = ?
           AND aws_account_id = ?`,
      )
      .bind(userEmail, awsAccountId)
      .all<GetRolesByUserAndAccountInternal>();

    if (!results || !results.results) {
      return [];
    }

    return results.results.map((row) => row.role_name);
  }

  /**
   * Retrieves a list of distinct AWS account IDs the user has access to.
   * @param userEmail The email address of the user.
   * @returns A list of distinct AWS account IDs.
   */
  public async getDistinctAccountIds(userEmail: string): Promise<string[]> {
    const results = await this.database
      .prepare('SELECT DISTINCT aws_account_id FROM assumable_roles WHERE user_email = ?')
      .bind(userEmail)
      .all<{ aws_account_id: string }>();

    return (results.results || []).map((row) => row.aws_account_id);
  }

  /**
   * Gets the total count of unique accounts accessible by the user.
   * @param userEmail The email address of the user.
   * @param showHidden Whether to include hidden roles in the count.
   * @returns The total number of unique accounts.
   */
  public async getTotalAccountsCount(userEmail: string, showHidden: boolean): Promise<number> {
    const hiddenFilter: string = showHidden ? '' : 'AND (ar.hidden IS NULL OR ar.hidden = FALSE)';
    const countResult: D1Result<GetTotalAccountsCountInternal> = await this.database
      .prepare(
        `SELECT COUNT(DISTINCT ar.aws_account_id) as total_accounts
         FROM assumable_roles ar
         WHERE ar.user_email = ? ${hiddenFilter}`,
      )
      .bind(userEmail)
      .all<GetTotalAccountsCountInternal>();
    return countResult?.results?.[0]?.total_accounts || 0;
  }

  /**
   * Retrieves all assumable roles for the specified user across all accessible AWS accounts.
   * @param userEmail The email address of the user.
   * @param showHidden Whether to include hidden roles in the results. Defaults to false.
   * @param limit Maximum number of roles to return. Defaults to 50.
   * @param offset Number of roles to skip. Defaults to 0.
   * @returns A map of AWS account IDs to objects containing roles and account nickname.
   */
  public async getAllRolesByUserEmail(
    userEmail: string,
    showHidden: boolean = false,
    limit: number = 50,
    offset: number = 0,
  ): Promise<AssumableAccountsMap> {
    const hiddenFilter: string = showHidden ? '' : 'AND (ar.hidden IS NULL OR ar.hidden = FALSE)';
    const results: D1Result<GetAllRolesByUserEmailInternal> = await this.database
      .prepare(
        `SELECT ar.aws_account_id, ar.role_name, ar.hidden, aa.aws_account_nickname,
                CASE WHEN ufa.aws_account_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
         FROM assumable_roles ar
         LEFT JOIN aws_accounts aa ON ar.aws_account_id = aa.aws_account_id
         LEFT JOIN user_favorite_accounts ufa ON ar.aws_account_id = ufa.aws_account_id AND ufa.user_email = ?
         WHERE ar.user_email = ? ${hiddenFilter}
         ORDER BY is_favorite DESC,
                  CASE WHEN aa.aws_account_nickname IS NOT NULL THEN 0 ELSE 1 END,
                  COALESCE(aa.aws_account_nickname, ar.aws_account_id)
         LIMIT ? OFFSET ?`,
      )
      .bind(userEmail, userEmail, limit, offset)
      .all<GetAllRolesByUserEmailInternal>();
    if (results && results.results) {
      const roleMap: AssumableAccountsMap = {};
      for (const row of results.results) {
        if (roleMap[row.aws_account_id] === undefined) {
          roleMap[row.aws_account_id] = {
            roles: [],
            hiddenRoles: [],
            nickname: row.aws_account_nickname || undefined,
            favorite: row.is_favorite === 1,
          };
        }
        if (row.hidden === 1) {
          roleMap[row.aws_account_id].hiddenRoles!.push(row.role_name);
        } else {
          roleMap[row.aws_account_id].roles.push(row.role_name);
        }
      }
      return roleMap;
    }
    return {};
  }

  /**
   * Verifies whether the specified user has permission to assume a given role in a specific AWS account.
   * Throws an UnauthorizedError if the user does not have access.
   *
   * @param userEmail - The email address of the user.
   * @param awsAccountId - The AWS account ID.
   * @param roleName - The name of the role to verify.
   * @throws UnauthorizedError if the user is not authorized to assume the specified role in the given AWS account.
   */
  public async verifyUserHasAccessToRole(userEmail: string, awsAccountId: string, roleName: string): Promise<void> {
    const result: Record<string, unknown> | null = await this.database
      .prepare(
        `SELECT 1
         FROM assumable_roles
         WHERE user_email = ?
           AND aws_account_id = ?
           AND role_name = ?
         LIMIT 1`,
      )
      .bind(userEmail, awsAccountId, roleName)
      .first();

    if (!result) {
      throw new UnauthorizedError(`${userEmail} is not authorized to assume role '${roleName}' in AWS account ${awsAccountId}.`);
    }
  }

  /**
   * Grants a user access to assume a specific role in an AWS account.
   * @param userEmail The email address of the user.
   * @param awsAccountId The AWS account ID.
   * @param roleName The name of the role to grant access to.
   */
  public async grantUserAccessToRole(userEmail: string, awsAccountId: string, roleName: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare(
        `INSERT OR IGNORE INTO assumable_roles (user_email, aws_account_id, role_name)
         VALUES (?, ?, ?)`,
      )
      .bind(userEmail, awsAccountId, roleName)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to grant user access to role: ${result.error}`);
    }
  }

  /**
   * Revokes a user's access to assume a specific role in an AWS account.
   * @param userEmail The email address of the user.
   * @param awsAccountId The AWS account ID.
   * @param roleName The name of the role to revoke access from.
   */
  public async revokeUserAccessToRole(userEmail: string, awsAccountId: string, roleName: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare(
        `DELETE FROM assumable_roles 
         WHERE user_email = ? AND aws_account_id = ? AND role_name = ?`,
      )
      .bind(userEmail, awsAccountId, roleName)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to revoke user access to role: ${result.error}`);
    }
  }

  /**
   * Hides a role for a specific user.
   * @param userEmail The email address of the user.
   * @param awsAccountId The AWS account ID.
   * @param roleName The name of the role to hide.
   */
  public async hideRole(userEmail: string, awsAccountId: string, roleName: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare(
        `UPDATE assumable_roles 
         SET hidden = TRUE 
         WHERE user_email = ? AND aws_account_id = ? AND role_name = ?`,
      )
      .bind(userEmail, awsAccountId, roleName)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to hide role: ${result.error}`);
    }
  }

  /**
   * Unhides a role for a specific user.
   * @param userEmail The email address of the user.
   * @param awsAccountId The AWS account ID.
   * @param roleName The name of the role to unhide.
   */
  public async unhideRole(userEmail: string, awsAccountId: string, roleName: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare(
        `UPDATE assumable_roles 
         SET hidden = FALSE 
         WHERE user_email = ? AND aws_account_id = ? AND role_name = ?`,
      )
      .bind(userEmail, awsAccountId, roleName)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to unhide role: ${result.error}`);
    }
  }

  /**
   * Searches accounts by AWS account ID or nickname that the user has access to.
   * @param userEmail The email address of the user.
   * @param query The search query to match against account ID or nickname.
   * @param showHidden Whether to include hidden roles. Defaults to false.
   * @returns A map of matching AWS account IDs to objects containing roles and account nickname.
   */
  public async searchAccountsByQuery(userEmail: string, query: string, showHidden: boolean = false): Promise<AssumableAccountsMap> {
    const hiddenFilter: string = showHidden ? '' : 'AND (ar.hidden IS NULL OR ar.hidden = FALSE)';
    const results: D1Result<GetAllRolesByUserEmailInternal> = await this.database
      .prepare(
        `SELECT ar.aws_account_id, ar.role_name, ar.hidden, aa.aws_account_nickname,
                CASE WHEN ufa.aws_account_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
         FROM assumable_roles ar
         LEFT JOIN aws_accounts aa ON ar.aws_account_id = aa.aws_account_id
         LEFT JOIN user_favorite_accounts ufa ON ar.aws_account_id = ufa.aws_account_id AND ufa.user_email = ?
         WHERE ar.user_email = ? ${hiddenFilter}
           AND (ar.aws_account_id LIKE ? OR aa.aws_account_nickname LIKE ?)
         ORDER BY is_favorite DESC,
                  CASE WHEN aa.aws_account_nickname IS NOT NULL THEN 0 ELSE 1 END,
                  COALESCE(aa.aws_account_nickname, ar.aws_account_id)`,
      )
      .bind(userEmail, userEmail, `%${query}%`, `%${query}%`)
      .all<GetAllRolesByUserEmailInternal>();
    if (results && results.results) {
      const roleMap: AssumableAccountsMap = {};
      for (const row of results.results) {
        if (roleMap[row.aws_account_id] === undefined) {
          roleMap[row.aws_account_id] = {
            roles: [],
            hiddenRoles: [],
            nickname: row.aws_account_nickname || undefined,
            favorite: row.is_favorite === 1,
          };
        }
        if (row.hidden === 1) {
          roleMap[row.aws_account_id].hiddenRoles!.push(row.role_name);
        } else {
          roleMap[row.aws_account_id].roles.push(row.role_name);
        }
      }
      return roleMap;
    }
    return {};
  }
}

interface GetRolesByUserAndAccountInternal {
  role_name: string;
}

interface GetAllRolesByUserEmailInternal {
  aws_account_id: string;
  role_name: string;
  hidden: number | null;
  aws_account_nickname: string | null;
  is_favorite: number;
}

interface GetTotalAccountsCountInternal {
  total_accounts: number;
}

export { AssumableRolesDAO };
