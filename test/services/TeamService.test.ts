import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamService } from '@aws-access-bridge/backend-services/team/TeamService';
import { AwsAccountsDAO, TeamAccountsDAO, TeamMembersDAO, TeamsDAO } from '@aws-access-bridge/backend-data/dao';
import { UserEmailDAO } from '@aws-access-bridge/backend-data/dao/UserEmailDAO';
import { UserMetadataDAO } from '@aws-access-bridge/backend-data/dao/UserMetadataDAO';
import { BadRequestError, NotFoundError } from '@aws-access-bridge/backend-errors';

vi.mock('@aws-access-bridge/backend-data/dao/TeamsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/TeamMembersDAO');
vi.mock('@aws-access-bridge/backend-data/dao/TeamAccountsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/AwsAccountsDAO');
// Migration 0032: resolution consults the address registry first, so an unstubbed
// one must read as "no registry row" and fall through to the anchor. A registry
// *hit* then hydrates through `UserMetadataDAO`, so both are needed for the
// resolved-id path.
vi.mock('@aws-access-bridge/backend-data/dao/UserEmailDAO');
vi.mock('@aws-access-bridge/backend-data/dao/UserMetadataDAO');

function db(): never {
  const chain = { bind: () => chain, run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) };
  return { prepare: () => chain } as never;
}

const ENV = { AccessBridgeDB: db() } as never;

function service(): TeamService {
  return new TeamService(ENV);
}

/**
 * `TeamService` is almost entirely input validation and owner resolution, and had
 * no direct tests — 75.6% statement coverage for the one class that guards every
 * team mutation. Two things are worth pinning here:
 *
 * - the guards themselves, since a missing one turns a `400` into a DAO call with
 *   an empty key, and
 * - that member operations resolve the *owner* (the `{userId, anchorEmail}` pair
 *   migration 0032 keys rows on) rather than re-deriving it per method, which is
 *   the drift `resolveOwner` exists to prevent.
 */
describe('TeamService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(UserEmailDAO.prototype.get).mockResolvedValue(null);
    vi.mocked(UserMetadataDAO.prototype.getByCurrentEmail).mockResolvedValue(null);
    vi.mocked(UserMetadataDAO.prototype.getByAnchor).mockResolvedValue(null);
    vi.mocked(UserMetadataDAO.prototype.getById).mockResolvedValue(null);
    vi.mocked(TeamsDAO.prototype.createTeam).mockResolvedValue({ teamId: 'team-1', teamName: 'Platform' } as never);
    vi.mocked(TeamsDAO.prototype.listTeams).mockResolvedValue([]);
    vi.mocked(TeamMembersDAO.prototype.getMembersByTeam).mockResolvedValue([]);
    vi.mocked(TeamAccountsDAO.prototype.getAccountsByTeam).mockResolvedValue([]);
  });

  describe('createTeam', () => {
    it('creates a team, trimming the name', async () => {
      const team = await service().createTeam('  Platform  ', 'user@example.com');
      expect(team).toEqual({ teamId: 'team-1', teamName: 'Platform' });
      expect(TeamsDAO.prototype.createTeam).toHaveBeenCalledWith('Platform', 'user@example.com');
    });

    // Annotated as a tuple array rather than left to inference. Without it `it.each`
    // infers a *union of tuples* — `[string, string] | [undefined, string]` — and a
    // single-parameter callback is not assignable to a union of arities, so the row
    // values never reached the parameter at all. `name as string` below is what the
    // `undefined` row is actually testing, so the cast moves to the table where the
    // `undefined` is visible.
    it.each<[string, string]>([
      ['', 'empty'],
      [' '.repeat(3), 'whitespace only'],
      [undefined as unknown as string, 'absent'],
    ])('rejects a %s team name (%s)', async (name) => {
      await expect(service().createTeam(name, 'user@example.com')).rejects.toThrow(BadRequestError);
      expect(TeamsDAO.prototype.createTeam).not.toHaveBeenCalled();
    });
  });

  describe('deleteTeam', () => {
    it('deletes a team', async () => {
      await service().deleteTeam('team-1');
      expect(TeamsDAO.prototype.deleteTeam).toHaveBeenCalledWith('team-1');
    });

    it('refuses to delete the default team', async () => {
      // The default team backs accounts that belong to nobody, so deleting it
      // would orphan every such account's team membership.
      await expect(service().deleteTeam('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/default team/i);
      expect(TeamsDAO.prototype.deleteTeam).not.toHaveBeenCalled();
    });

    it('rejects an absent team id', async () => {
      await expect(service().deleteTeam('')).rejects.toThrow(BadRequestError);
      expect(TeamsDAO.prototype.deleteTeam).not.toHaveBeenCalled();
    });
  });

  describe('listTeams', () => {
    it('returns the teams', async () => {
      vi.mocked(TeamsDAO.prototype.listTeams).mockResolvedValue([{ teamId: 'team-1', teamName: 'Platform' }] as never);
      await expect(service().listTeams()).resolves.toEqual([{ teamId: 'team-1', teamName: 'Platform' }]);
    });
  });

  describe('updateTeamName', () => {
    it('updates the name, trimmed', async () => {
      await service().updateTeamName('team-1', '  Renamed  ');
      expect(TeamsDAO.prototype.updateTeamName).toHaveBeenCalledWith('team-1', 'Renamed');
    });

    it.each([
      ['', 'New Name'],
      ['team-1', ''],
      ['team-1', ' '.repeat(3)],
    ])('rejects teamId=%p name=%p', async (teamId, name) => {
      await expect(service().updateTeamName(teamId, name)).rejects.toThrow(BadRequestError);
      expect(TeamsDAO.prototype.updateTeamName).not.toHaveBeenCalled();
    });
  });

  describe('addMember', () => {
    it('adds a member with the default role', async () => {
      await service().addMember('team-1', 'user@example.com');
      expect(TeamMembersDAO.prototype.addMember).toHaveBeenCalledWith(
        'team-1',
        { userId: null, anchorEmail: 'user@example.com' },
        'member',
      );
    });

    it('honours an explicit role', async () => {
      await service().addMember('team-1', 'user@example.com', 'admin');
      expect(TeamMembersDAO.prototype.addMember).toHaveBeenCalledWith(
        'team-1',
        expect.objectContaining({ anchorEmail: 'user@example.com' }),
        'admin',
      );
    });

    it('resolves the stable account id when the registry has a row', async () => {
      // With a registry row the write must be keyed on `user_id`, so the
      // membership survives an address change.
      vi.mocked(UserEmailDAO.prototype.get).mockResolvedValue({
        email: 'user@example.com',
        user_id: 'usr_abc',
        is_verified: 1,
        created_at: 1,
      });
      vi.mocked(UserMetadataDAO.prototype.getById).mockResolvedValue({
        id: 'usr_abc',
        user_email: 'user@example.com',
        current_email: 'user@example.com',
      });
      await service().addMember('team-1', 'user@example.com');
      expect(TeamMembersDAO.prototype.addMember).toHaveBeenCalledWith(
        'team-1',
        { userId: 'usr_abc', anchorEmail: 'user@example.com' },
        'member',
      );
    });

    it('does NOT resolve a revoked address to its previous holder', async () => {
      // A revoked registry row must not fall through to the metadata lookup, or a
      // reassigned address would keep authenticating the previous account.
      vi.mocked(UserEmailDAO.prototype.get).mockResolvedValue({
        email: 'user@example.com',
        user_id: 'usr_old',
        is_verified: 0,
        created_at: 1,
      });
      vi.mocked(UserMetadataDAO.prototype.getByAnchor).mockResolvedValue({ id: 'usr_old', user_email: 'user@example.com' });

      await service().addMember('team-1', 'user@example.com');

      // Falls back to the address arm of the owner predicate rather than `usr_old`.
      expect(TeamMembersDAO.prototype.addMember).toHaveBeenCalledWith(
        'team-1',
        { userId: null, anchorEmail: 'user@example.com' },
        'member',
      );
    });

    it('falls back to a null id for an unresolvable address', async () => {
      // An unknown actor reads as "no account" rather than erroring — a 404 here
      // would turn the address space into an account-enumeration oracle.
      await service().addMember('team-1', 'stranger@example.com');
      expect(TeamMembersDAO.prototype.addMember).toHaveBeenCalledWith(
        'team-1',
        { userId: null, anchorEmail: 'stranger@example.com' },
        'member',
      );
    });

    it.each([
      ['', 'user@example.com'],
      ['team-1', ''],
    ])('rejects teamId=%p email=%p', async (teamId, email) => {
      await expect(service().addMember(teamId, email)).rejects.toThrow(BadRequestError);
      expect(TeamMembersDAO.prototype.addMember).not.toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    it('removes a member by owner', async () => {
      await service().removeMember('team-1', 'user@example.com');
      expect(TeamMembersDAO.prototype.removeMember).toHaveBeenCalledWith('team-1', { userId: null, anchorEmail: 'user@example.com' });
    });

    it.each([
      ['', 'user@example.com'],
      ['team-1', ''],
    ])('rejects teamId=%p email=%p', async (teamId, email) => {
      await expect(service().removeMember(teamId, email)).rejects.toThrow(BadRequestError);
      expect(TeamMembersDAO.prototype.removeMember).not.toHaveBeenCalled();
    });
  });

  describe('listMembers', () => {
    it('returns the members', async () => {
      vi.mocked(TeamMembersDAO.prototype.getMembersByTeam).mockResolvedValue([{ userEmail: 'user@example.com', role: 'member' }] as never);
      await expect(service().listMembers('team-1')).resolves.toEqual([{ userEmail: 'user@example.com', role: 'member' }]);
    });

    it('rejects an absent team id', async () => {
      await expect(service().listMembers('')).rejects.toThrow(BadRequestError);
      expect(TeamMembersDAO.prototype.getMembersByTeam).not.toHaveBeenCalled();
    });
  });

  describe('updateMemberRole', () => {
    it('updates the role by owner', async () => {
      await service().updateMemberRole('team-1', 'user@example.com', 'admin');
      expect(TeamMembersDAO.prototype.updateMemberRole).toHaveBeenCalledWith(
        'team-1',
        { userId: null, anchorEmail: 'user@example.com' },
        'admin',
      );
    });

    it.each([
      ['', 'user@example.com', 'admin'],
      ['team-1', '', 'admin'],
      // Unlike addMember, role has no default here — an empty role would write a
      // member with no permissions and no error.
      ['team-1', 'user@example.com', ''],
    ])('rejects teamId=%p email=%p role=%p', async (teamId, email, role) => {
      await expect(service().updateMemberRole(teamId, email, role)).rejects.toThrow(BadRequestError);
      expect(TeamMembersDAO.prototype.updateMemberRole).not.toHaveBeenCalled();
    });
  });

  describe('account membership', () => {
    it('adds an account to a team', async () => {
      vi.mocked(AwsAccountsDAO.prototype.accountExists).mockResolvedValue(true);
      await service().addAccount('team-1', '123456789012');
      expect(TeamAccountsDAO.prototype.addAccountToTeam).toHaveBeenCalledWith('team-1', '123456789012');
    });

    it('refuses an account the deployment has never connected', async () => {
      // Adding the account as a side effect of a typo is the failure this
      // guards: `ensureAccountExists` would silently connect it.
      vi.mocked(AwsAccountsDAO.prototype.accountExists).mockResolvedValue(false);
      await expect(service().addAccount('team-1', '123456789012')).rejects.toThrow(NotFoundError);
      expect(TeamAccountsDAO.prototype.addAccountToTeam).not.toHaveBeenCalled();
    });

    it('removes an account from a team', async () => {
      await service().removeAccount('team-1', '123456789012');
      expect(TeamAccountsDAO.prototype.removeAccountFromTeam).toHaveBeenCalledWith('team-1', '123456789012');
    });

    it('lists a team’s accounts', async () => {
      vi.mocked(TeamAccountsDAO.prototype.getAccountsByTeam).mockResolvedValue(['123456789012']);
      await expect(service().listAccounts('team-1')).resolves.toEqual(['123456789012']);
    });

    // Three columns, because the callback takes three arguments and the title has three
    // placeholders. The table supplied **two**, so `accountId` was always `undefined`
    // whatever the row said — which is why this read as a test of "a missing field" while
    // only ever testing a missing *team id*, and why the parameters were implicitly `any`:
    // the row arity and the callback arity did not agree, so neither could be checked.
    //
    // Each method now appears twice with the field that is missing named, which is what
    // the title claims.
    it.each<[string, string, string]>([
      ['addAccount', '', '123456789012'],
      ['addAccount', 'team-1', ''],
      ['removeAccount', '', '123456789012'],
      ['removeAccount', 'team-1', ''],
    ])('%s(%p, %p) rejects a missing field', async (method, teamId, accountId) => {
      const call = service()[method as 'addAccount' | 'removeAccount'].bind(service());
      await expect(call(teamId, accountId)).rejects.toThrow(BadRequestError);
    });

    it('listAccounts rejects an absent team id', async () => {
      await expect(service().listAccounts('')).rejects.toThrow(BadRequestError);
      expect(TeamAccountsDAO.prototype.getAccountsByTeam).not.toHaveBeenCalled();
    });
  });
});
