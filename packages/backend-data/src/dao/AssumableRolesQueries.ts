/**
 * Shared SQL fragments + row-mapping for `AssumableRolesDAO`.
 * Previously `getAllRolesByUserEmail` vs `searchAccountsByQuery` duplicated
 * ~18 lines of identical `roleMap` build + near-identical FROM/JOIN SQL
 * (only the LIKE clause differed). Extracted before it hits 500+ lines
 * (Otter `ConnectedApplicationMetadataMapper` precedent).
 */

const ASSUMABLE_ROLES_FROM_JOIN = `FROM assumable_roles ar
          LEFT JOIN aws_accounts aa ON ar.aws_account_id = aa.aws_account_id
          LEFT JOIN user_favorite_accounts ufa ON ar.aws_account_id = ufa.aws_account_id AND ufa.user_email = ?`;

const ASSUMABLE_ROLES_ORDER_BY = `ORDER BY is_favorite DESC,
                   CASE WHEN aa.aws_account_nickname IS NOT NULL THEN 0 ELSE 1 END,
                   COALESCE(aa.aws_account_nickname, ar.aws_account_id)`;

const ASSUMABLE_ROLES_SELECT = `SELECT ar.aws_account_id, ar.role_name, ar.hidden, aa.aws_account_nickname,
                CASE WHEN ufa.aws_account_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite`;

function hiddenFilterClause(showHidden: boolean): string {
  return showHidden ? '' : 'AND (ar.hidden IS NULL OR ar.hidden = FALSE)';
}

function buildListRolesQuery(showHidden: boolean): string {
  const hiddenFilter: string = hiddenFilterClause(showHidden);
  return `${ASSUMABLE_ROLES_SELECT}
          ${ASSUMABLE_ROLES_FROM_JOIN}
          WHERE ar.user_email = ? ${hiddenFilter}
          ${ASSUMABLE_ROLES_ORDER_BY}
          LIMIT ? OFFSET ?`;
}

function buildSearchRolesQuery(showHidden: boolean): string {
  const hiddenFilter: string = hiddenFilterClause(showHidden);
  return `${ASSUMABLE_ROLES_SELECT}
          ${ASSUMABLE_ROLES_FROM_JOIN}
          WHERE ar.user_email = ? ${hiddenFilter}
            AND (ar.aws_account_id LIKE ? OR aa.aws_account_nickname LIKE ?)
          ${ASSUMABLE_ROLES_ORDER_BY}`;
}

export { ASSUMABLE_ROLES_FROM_JOIN, ASSUMABLE_ROLES_ORDER_BY, ASSUMABLE_ROLES_SELECT, buildListRolesQuery, buildSearchRolesQuery, hiddenFilterClause };
