# Team Workspaces

Scope: the team tables, the admin surface, and — importantly — what team membership does and does
not currently gate. Parent index: [`../../../../AGENTS.md`](../../../../AGENTS.md).

## The tables

`teams`, `team_members` (role `admin` or `member`), `team_accounts`. DAOs: `TeamsDAO`,
`TeamMembersDAO`, `TeamAccountsDAO`; service: `TeamService` (`Tokens.TeamService`).

A default team, `00000000-0000-0000-0000-000000000000`, is seeded by `migrations/0030_squash.sql`
and holds every account and member that existed before teams. It cannot be deleted —
`TeamService.deleteTeam` rejects that id with `BadRequestError`.

`TeamService.createTeam` adds the creator as `owner`, i.e. a member whose `user_email` is the
account's **anchor**, which is why `team_members` is half-keyed on it (see
[`../../../../packages/backend-data/AGENTS.md`](../../../../packages/backend-data/AGENTS.md)).

## Three roles exist; two of them are currently inert

This is the part worth knowing before you rely on it.

`team_members.role` is `admin` or `member`, and `TeamMembersDAO.isTeamAdmin(teamId, owner)` exists
to read it. **That method has no production caller.** Nothing on the read path consults teams:
`AssumableRolesDAO` and `AssumableRolesQueries` never join `team_accounts`, so
`GET /user/assumables`, the cost reads and the resource reads are driven entirely by
`assumable_roles` grants and the caller's owner predicate.

What that means in practice:

- Team membership is **recorded and displayed**, not **enforced**.
- A team admin has no capability a team member lacks: every `/user/admin/team/*` route extends
  `IAdminActivityAPIRoute`, whose guard is demo-mode plus **superadmin**, not team role.
- Adding an account to a team does not restrict who can assume it; removing it does not revoke.

Superadmin is the only tier with teeth, and it is global (`UserMetadataDAO.isSuperAdmin`).

This is a real gap between the docs-that-used-to-exist and the code, not a subtlety. If you
implement enforcement, the shape is: resolve the caller's teams and admin flag once per request
(there are already `getTeamsByUserEmail` / `getTeamsByUserId` DAO methods for it), then narrow the
account set the assumables query returns — and add a per-file coverage floor, because the predicate
that decides who sees which account is exactly the kind of code that rots unnoticed.

## The surface

`/user/admin/team*` — `POST|DELETE /user/admin/team`, `GET /user/admin/teams`, `PUT …/team/name`,
`POST|DELETE …/team/member`, `GET …/team/members`, `PUT …/team/member/role`,
`POST|DELETE …/team/account`, `GET …/team/accounts`. All superadmin-gated, all audited.

Frontend: `TeamsTab` in `apps/web` holds handlers only; its three sections are
`teams/TeamListSection`, `teams/TeamMembersSection` and `teams/TeamAccountsSection`.

Team accounts are cleaned up by the orphan sweep (`TeamAccountsDAO.deleteOrphaned`), so removing a
role grant eventually removes the team link through
`POST /user/admin/maintenance/cleanup-orphaned`.
