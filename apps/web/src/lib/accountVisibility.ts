import type { RoleMap } from '../services/accountService';

type AccountRoles = RoleMap[string];

/**
 * The optimistic result of hiding or un-hiding one role.
 *
 * `hiddenRoles` only mirrors what the list is currently *showing*. With the
 * "show hidden" filter on, a role being hidden must move from `roles` to
 * `hiddenRoles` so its row is not lost; with the filter off it simply leaves the
 * visible list, and recording it would list a role the user cannot see. Either
 * way the server is authoritative — toggling the filter refetches — so a stale
 * mirror is never shown for long.
 *
 * `currentlyHidden` is the role's state *before* the toggle. Un-hiding a role
 * that is already visible does not duplicate it.
 */
function applyHiddenToggle(previous: AccountRoles, role: string, currentlyHidden: boolean, showHidden: boolean): AccountRoles {
  const hiddenRoles = previous.hiddenRoles ?? [];
  if (currentlyHidden) {
    return {
      ...previous,
      roles: previous.roles.includes(role) ? previous.roles : [...previous.roles, role],
      hiddenRoles: hiddenRoles.filter((name) => name !== role),
    };
  }
  return {
    ...previous,
    roles: previous.roles.filter((name) => name !== role),
    hiddenRoles: showHidden && !hiddenRoles.includes(role) ? [...hiddenRoles, role] : hiddenRoles,
  };
}

export type { AccountRoles };
export { applyHiddenToggle };
