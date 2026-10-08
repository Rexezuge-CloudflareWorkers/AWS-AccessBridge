import { ForbiddenError } from '@aws-access-bridge/backend-errors';
import type { AssumableAccountsMap } from '@aws-access-bridge/shared/model';
import { mapRowsToAssumableMap } from './AssumableRolesMapper';
import type { AssumableRoleRow } from './AssumableRolesMapper';
import { buildListRolesQuery, buildSearchRolesQuery, hiddenFilterClause, ownerClause } from './AssumableRolesQueries';
import { LIKEUtil } from '../utils/LIKEUtil';
import { BaseDAO } from './BaseDAO';

import { assertD1Success } from '../utils/D1Utils';
/**
 * Who a user-keyed `assumable_roles` statement is about.
 *
 * `userId` is the account id and `anchorEmail` its frozen anchor. The id is
 * matched first because it is the stable key; the anchor arm exists only for
 * rows the 0032 backfill could not attribute, and the `user_id IS NULL` guard is
 * what keeps the two arms from double-matching a row.
 */
interface AssumableRoleOwner {
  userId: string | null;
  anchorEmail: string;
}

class AssumableRolesDAO extends BaseDAO {
  /**
   * Retrieves a list of role names that the specified user can assume within the given AWS account.
   * @param userEmail The email address of the user.
   * @param awsAccountId The AWS account ID to query roles for.
   * @returns A list of role names the user is authorized to assume in the account.
   */
  public async getRolesByUserAndAccount(owner: AssumableRoleOwner, awsAccountId: string): Promise<Array<string>> {
    const results: D1Result<GetRolesByUserAndAccountInternal> = await this.database
      .prepare(
        `SELECT role_name
         FROM assumable_roles
         WHERE ${ownerClause('assumable_roles')} AND aws_account_id = ?`,
      )
      .bind(owner.userId, owner.anchorEmail, awsAccountId)
      .all<GetRolesByUserAndAccountInternal>();

    return results?.results ? results.results.map((row) => row.role_name) : [];
  }

  /**
   * Retrieves a list of distinct AWS account IDs the user has access to.
   * @param userEmail The email address of the user.
   * @returns A list of distinct AWS account IDs.
   */
  /**
   * Every role the caller holds, one row per (account, role).
   *
   * Used to build the roles-per-account map without one query per account:
   * the N+1 cost is identical to the N queries it replaces only when an
   * account has zero roles, which cannot happen — an account only appears in
   * the inventory result when it has a grant.
   */
  public async getRolesByOwner(owner: AssumableRoleOwner): Promise<Array<{ awsAccountId: string; roleName: string }>> {
    const results = await this.database
      .prepare(
        `SELECT aws_account_id, role_name FROM assumable_roles WHERE ${ownerClause('assumable_roles')} ORDER BY aws_account_id, role_name`,
      )
      .bind(owner.userId, owner.anchorEmail)
      .all<{ aws_account_id: string; role_name: string }>();
    return (results.results || []).map((row) => ({ awsAccountId: row.aws_account_id, roleName: row.role_name }));
  }

  public async getDistinctAccountIds(owner: AssumableRoleOwner): Promise<string[]> {
    const results = await this.database
      .prepare(`SELECT DISTINCT aws_account_id FROM assumable_roles WHERE ${ownerClause('assumable_roles')}`)
      .bind(owner.userId, owner.anchorEmail)
      .all<{ aws_account_id: string }>();

    return (results.results || []).map((row) => row.aws_account_id);
  }

  /**
   * Gets the total count of unique accounts accessible by the user.
   * @param userEmail The email address of the user.
   * @param showHidden Whether to include hidden roles in the count.
   * @returns The total number of unique accounts.
   */
  public async getTotalAccountsCount(owner: AssumableRoleOwner, showHidden: boolean): Promise<number> {
    const hiddenFilter: string = hiddenFilterClause(showHidden);
    const countResult: D1Result<GetTotalAccountsCountInternal> = await this.database
      .prepare(
        `SELECT COUNT(DISTINCT ar.aws_account_id) as total_accounts
         FROM assumable_roles ar
         WHERE ${ownerClause('ar')} ${hiddenFilter}`,
      )
      .bind(owner.userId, owner.anchorEmail)
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
  public async getAllRolesByOwner(
    owner: AssumableRoleOwner,
    showHidden: boolean = false,
    limit: number = 50,
    offset: number = 0,
  ): Promise<AssumableAccountsMap> {
    const results: D1Result<AssumableRoleRow> = await this.database
      .prepare(buildListRolesQuery(showHidden))
      // Favourites join owner, then role owner, then the subquery's favourites
      // join owner, the subquery's role owner, then paging. See the note in
      // `AssumableRolesQueries` for why the first two are separate bindings.
      .bind(
        owner.userId,
        owner.anchorEmail,
        owner.userId,
        owner.anchorEmail,
        owner.userId,
        owner.anchorEmail,
        owner.userId,
        owner.anchorEmail,
        limit,
        offset,
      )
      .all<AssumableRoleRow>();
    return results?.results ? mapRowsToAssumableMap(results.results) : {};
  }

  /**
   * Verifies whether the specified user has permission to assume a given role in a specific AWS account.
   * Throws a ForbiddenError if the user does not have access.
   *
   * @param owner - The resolved account owner.
   * @param awsAccountId - The AWS account ID.
   * @param roleName - The name of the role to verify.
   * @throws ForbiddenError if the user is not authorized to assume the specified role in the given AWS account.
   */
  public async verifyUserHasAccessToRole(owner: AssumableRoleOwner, awsAccountId: string, roleName: string): Promise<void> {
    const result: Record<string, unknown> | null = await this.database
      .prepare(
        `SELECT 1
         FROM assumable_roles
         WHERE ${ownerClause('assumable_roles')}
           AND aws_account_id = ?
           AND role_name = ?
         LIMIT 1`,
      )
      .bind(owner.userId, owner.anchorEmail, awsAccountId, roleName)
      .first();

    if (!result) {
      // No-grant is a 403, not a 401: re-authenticating cannot manufacture a
      // grant, and the SPA reads 401 as "sign in again". The message carries
      // no anchor address — telling an account that changed addresses it lost
      // access under a name it no longer uses leaks account state, and the
      // anchor must never surface to the caller.
      throw new ForbiddenError(`Not authorized to assume role '${roleName}' in AWS account ${awsAccountId}.`);
    }
  }

  /**
   * Grant an account access to assume a role.
   *
   * `user_email` keeps the anchor: it is the foreign key the schema cannot
   * repoint, and the pre-0032 `(user_email, aws_account_id, role_name)` primary
   * key still deduplicates on it. `INSERT OR IGNORE` additionally honours the
   * 0032 `(user_id, aws_account_id, role_name)` unique index, so re-granting
   * after an address change is still a no-op rather than a second grant.
   */
  public async grantUserAccessToRole(owner: AssumableRoleOwner, awsAccountId: string, roleName: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare(
        `INSERT OR IGNORE INTO assumable_roles (user_email, user_id, aws_account_id, role_name)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(owner.anchorEmail, owner.userId, awsAccountId, roleName)
      .run();
    assertD1Success(result, `grant user access to role`);
  }

  /**
   * Revokes a user's access to assume a specific role in an AWS account.
   * @param userEmail The email address of the user.
   * @param awsAccountId The AWS account ID.
   * @param roleName The name of the role to revoke access from.
   */
  public async revokeUserAccessToRole(owner: AssumableRoleOwner, awsAccountId: string, roleName: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare(
        `DELETE FROM assumable_roles
         WHERE ${ownerClause('assumable_roles')} AND aws_account_id = ? AND role_name = ?`,
      )
      .bind(owner.userId, owner.anchorEmail, awsAccountId, roleName)
      .run();
    assertD1Success(result, `revoke user access to role`);
  }

  /**
   * Hides a role for a specific user.
   * @param userEmail The email address of the user.
   * @param awsAccountId The AWS account ID.
   * @param roleName The name of the role to hide.
   */
  public async hideRole(owner: AssumableRoleOwner, awsAccountId: string, roleName: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare(
        `UPDATE assumable_roles
         SET hidden = TRUE
         WHERE ${ownerClause('assumable_roles')} AND aws_account_id = ? AND role_name = ?`,
      )
      .bind(owner.userId, owner.anchorEmail, awsAccountId, roleName)
      .run();
    assertD1Success(result, `hide role`);
  }

  /**
   * Unhides a role for a specific user.
   * @param userEmail The email address of the user.
   * @param awsAccountId The AWS account ID.
   * @param roleName The name of the role to unhide.
   */
  public async unhideRole(owner: AssumableRoleOwner, awsAccountId: string, roleName: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare(
        `UPDATE assumable_roles
         SET hidden = FALSE
         WHERE ${ownerClause('assumable_roles')} AND aws_account_id = ? AND role_name = ?`,
      )
      .bind(owner.userId, owner.anchorEmail, awsAccountId, roleName)
      .run();
    assertD1Success(result, `unhide role`);
  }

  /**
   * Searches accounts by AWS account ID or nickname that the user has access to.
   * @param userEmail The email address of the user.
   * @param query The search query to match against account ID or nickname.
   * @param showHidden Whether to include hidden roles. Defaults to false.
   * @returns A map of matching AWS account IDs to objects containing roles and account nickname.
   */
  public async searchAccountsByQuery(owner: AssumableRoleOwner, query: string, showHidden: boolean = false): Promise<AssumableAccountsMap> {
    const results: D1Result<AssumableRoleRow> = await this.database
      .prepare(buildSearchRolesQuery(showHidden))
      // LIKE metacharacters escaped: an unescaped `%` in the search box matched
      // every role instead of searching for a literal `%`.
      .bind(owner.userId, owner.anchorEmail, owner.userId, owner.anchorEmail, LIKEUtil.contains(query), LIKEUtil.contains(query))
      .all<AssumableRoleRow>();
    return results?.results ? mapRowsToAssumableMap(results.results) : {};
  }
}

interface GetRolesByUserAndAccountInternal {
  role_name: string;
}

interface GetTotalAccountsCountInternal {
  total_accounts: number;
}

export { AssumableRolesDAO };
export type { AssumableRoleOwner };
