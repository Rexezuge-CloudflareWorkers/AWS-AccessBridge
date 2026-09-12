# Team Workspaces

Scope: multi-tenant team boundaries. Parent index: `../../../AGENTS.md`.

Tables: `teams`, `team_members` (role `admin`/`member`), `team_accounts` (`TeamsDAO`, `TeamMembersDAO`, `TeamAccountsDAO`). A default team (`00000000-0000-0000-0000-000000000000`) seeds all existing data (migration 0026). Three tiers: global superadmin (`UserMetadataDAO.isSuperAdmin`), team admin, team member. Teams scope at the account level via `team_accounts` — credentials stay shared. Admin surface: `/user/admin/teams/*` (CRUD, name, members, member role, accounts). Frontend: `TeamsTab` in `apps/web`.
