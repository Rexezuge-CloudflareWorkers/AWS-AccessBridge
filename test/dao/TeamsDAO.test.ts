import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamsDAO } from '@aws-access-bridge/backend-data/dao/TeamsDAO';
import { TeamMembersDAO } from '@aws-access-bridge/backend-data/dao/TeamMembersDAO';

function createMockDb() {
  const mockStmt = {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({ success: true }),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
    raw: vi.fn(),
  };
  const mockDb = {
    prepare: vi.fn().mockReturnValue(mockStmt),
    exec: vi.fn(),
    batch: vi.fn(),
    dump: vi.fn(),
  };
  return { mockDb, mockStmt };
}

describe('TeamsDAO', () => {
  let mockDb: any;
  let mockStmt: any;

  beforeEach(() => {
    ({ mockDb, mockStmt } = createMockDb());
  });

  it('creates a team and returns it', async () => {
    const dao = new TeamsDAO(mockDb);
    const team = await dao.createTeam('Ops', 'admin@example.com');
    expect(team.teamName).toBe('Ops');
    expect(team.teamId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO teams'));
  });

  it('returns null for unknown teams', async () => {
    const dao = new TeamsDAO(mockDb);
    await expect(dao.getTeamById('missing')).resolves.toBeNull();
  });

  it('maps team rows to external models', async () => {
    vi.mocked(mockStmt.first).mockResolvedValue({ team_id: 't1', team_name: 'Ops', created_at: 1, created_by: 'a@b.c' });
    const dao = new TeamsDAO(mockDb);
    await expect(dao.getTeamById('t1')).resolves.toEqual({ teamId: 't1', teamName: 'Ops', createdAt: 1, createdBy: 'a@b.c' });
  });

  it('lists teams ordered by name', async () => {
    vi.mocked(mockStmt.all).mockResolvedValue({ results: [{ team_id: 't1', team_name: 'B', created_at: 1, created_by: 'x' }] });
    const dao = new TeamsDAO(mockDb);
    const teams = await dao.listTeams();
    expect(teams).toHaveLength(1);
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY team_name'));
  });

  it('deletes team accounts, members, then the team', async () => {
    const dao = new TeamsDAO(mockDb);
    await dao.deleteTeam('t1');
    expect(vi.mocked(mockDb.prepare).mock.calls.map((c: unknown[]) => c[0])).toEqual([
      expect.stringContaining('DELETE FROM team_accounts'),
      expect.stringContaining('DELETE FROM team_members'),
      expect.stringContaining('DELETE FROM teams'),
    ]);
  });

  it('updates the team name', async () => {
    const dao = new TeamsDAO(mockDb);
    await dao.updateTeamName('t1', 'New');
    expect(mockStmt.bind).toHaveBeenCalledWith('New', 't1');
  });
});

describe('TeamMembersDAO', () => {
  let mockDb: any;
  let mockStmt: any;

  beforeEach(() => {
    ({ mockDb, mockStmt } = createMockDb());
  });

  it('adds members with the default role', async () => {
    const dao = new TeamMembersDAO(mockDb);
    await dao.addMember('t1', 'user@example.com');
    expect(mockStmt.bind).toHaveBeenCalledWith('t1', 'user@example.com', 'member', expect.any(Number));
  });

  it('removes members', async () => {
    const dao = new TeamMembersDAO(mockDb);
    await dao.removeMember('t1', 'user@example.com');
    expect(mockStmt.bind).toHaveBeenCalledWith('t1', 'user@example.com');
  });

  it('detects team admins by role', async () => {
    vi.mocked(mockStmt.first).mockResolvedValue({ role: 'admin' });
    const dao = new TeamMembersDAO(mockDb);
    await expect(dao.isTeamAdmin('t1', 'user@example.com')).resolves.toBe(true);
    vi.mocked(mockStmt.first).mockResolvedValue({ role: 'member' });
    await expect(dao.isTeamAdmin('t1', 'user@example.com')).resolves.toBe(false);
    vi.mocked(mockStmt.first).mockResolvedValue(null);
    await expect(dao.isTeamAdmin('t1', 'user@example.com')).resolves.toBe(false);
  });

  it('lists teams for a user', async () => {
    vi.mocked(mockStmt.all).mockResolvedValue({ results: [{ team_id: 't1', team_name: 'Ops', role: 'admin' }] });
    const dao = new TeamMembersDAO(mockDb);
    await expect(dao.getTeamsByUserEmail('u@e.c')).resolves.toEqual([{ teamId: 't1', teamName: 'Ops', role: 'admin' }]);
  });

  it('lists and maps team members', async () => {
    vi.mocked(mockStmt.all).mockResolvedValue({ results: [{ team_id: 't1', user_email: 'u@e.c', role: 'member', joined_at: 5 }] });
    const dao = new TeamMembersDAO(mockDb);
    await expect(dao.getMembersByTeam('t1')).resolves.toEqual([{ teamId: 't1', userEmail: 'u@e.c', role: 'member', joinedAt: 5 }]);
  });

  it('updates member roles', async () => {
    const dao = new TeamMembersDAO(mockDb);
    await dao.updateMemberRole('t1', 'u@e.c', 'admin');
    expect(mockStmt.bind).toHaveBeenCalledWith('admin', 't1', 'u@e.c');
  });
});
