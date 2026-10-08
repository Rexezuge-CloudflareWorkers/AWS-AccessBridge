import type { TeamRole } from '../services/teamsService';

/**
 * The roles a team member can hold, in the order the role pickers list them.
 * `TeamRole` is the shared `TeamMember['role']`, so this list cannot drift from
 * what the server accepts without a type error.
 */
const TEAM_ROLES: readonly TeamRole[] = ['member', 'admin'];

const DEFAULT_TEAM_ROLE: TeamRole = 'member';

/**
 * Narrows the string a `<select>` hands back. A value outside the list — which a
 * hand-edited DOM could produce — is rejected rather than cast, so it never
 * reaches the API.
 */
function isTeamRole(value: string): value is TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(value);
}

export { DEFAULT_TEAM_ROLE, TEAM_ROLES, isTeamRole };
