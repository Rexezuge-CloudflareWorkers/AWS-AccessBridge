import type { AssumableAccountsMap } from '@aws-access-bridge/shared/model';

interface AssumableRoleRow {
  aws_account_id: string;
  role_name: string;
  hidden: number | null;
  aws_account_nickname: string | null;
  is_favorite: number;
}

/**
 * Pure row → `AssumableAccountsMap` mapper (unit-tested without D1).
 * Previously inlined twice in `AssumableRolesDAO`.
 */
function mapRowsToAssumableMap(rows: AssumableRoleRow[]): AssumableAccountsMap {
  const roleMap: AssumableAccountsMap = {};
  for (const row of rows) {
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

export { mapRowsToAssumableMap };
export type { AssumableRoleRow };
