import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTeams } from '@aws-access-bridge/web/hooks/useTeams';
import * as teamsService from '@aws-access-bridge/web/services/teamsService';
import type { Team, TeamMember } from '@aws-access-bridge/web/services/teamsService';

/**
 * `useTeams` under a real renderer.
 *
 * The behaviour worth testing here is the monotonic request guard, which cannot
 * be observed without React: switching teams fires overlapping requests, and
 * without the guard the slower *earlier* one resolves last and renders the
 * previously-selected team's members under the new selection. A node-environment
 * test of the extracted guard proves the arithmetic; only this proves the hook
 * actually consults it in all three of the success, error, and spinner-teardown
 * paths.
 */
vi.mock('@aws-access-bridge/web/services/teamsService');

const mocked = vi.mocked(teamsService);

const TEAM_A: Team = { teamId: 'team-a', teamName: 'Alpha', createdBy: 'u', createdAt: 1 };
const TEAM_B: Team = { teamId: 'team-b', teamName: 'Beta', createdBy: 'u', createdAt: 2 };

/** A promise plus its resolvers, so a test can decide resolution order. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useTeams', () => {
  const onError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listTeams.mockResolvedValue([]);
    mocked.listTeamMembers.mockResolvedValue([]);
    mocked.listTeamAccounts.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the team list on mount', async () => {
    mocked.listTeams.mockResolvedValue([TEAM_A, TEAM_B]);
    const { result } = renderHook(() => useTeams(onError));

    await waitFor(() => {
      expect(result.current.teams).toHaveLength(2);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.selectedTeamId).toBeNull();
  });

  it('reports a failed team list through onError and stops loading', async () => {
    // Previously this reported a fixed message; the API's own text is more
    // useful to an operator reading the toast.
    mocked.listTeams.mockRejectedValue(new Error('teams table missing'));
    const { result } = renderHook(() => useTeams(onError));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('teams table missing');
    });
    expect(result.current.isLoading).toBe(false);
  });

  it('loads members and accounts for a selected team', async () => {
    const members: TeamMember[] = [{ userEmail: 'a@example.com', role: 'member' }];
    mocked.listTeamMembers.mockResolvedValue(members);
    mocked.listTeamAccounts.mockResolvedValue(['123456789012']);
    const { result } = renderHook(() => useTeams(onError));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.selectTeam('team-a');
    });

    expect(mocked.listTeamMembers).toHaveBeenCalledWith('team-a');
    expect(mocked.listTeamAccounts).toHaveBeenCalledWith('team-a');
    await waitFor(() => {
      expect(result.current.members).toEqual(members);
    });
    expect(result.current.accounts).toEqual(['123456789012']);
    expect(result.current.selectedTeamId).toBe('team-a');
  });

  it('does not show team A’s members after switching to team B', async () => {
    // The out-of-order guard. Team A's request is slower and resolves *after*
    // team B's, so without the guard it would overwrite B's results.
    const slowA = deferred<TeamMember[]>();
    const fastB = deferred<TeamMember[]>();
    mocked.listTeamMembers.mockReturnValueOnce(slowA.promise).mockReturnValueOnce(fastB.promise);

    const { result } = renderHook(() => useTeams(onError));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.selectTeam('team-a');
    });
    act(() => {
      result.current.selectTeam('team-b');
    });

    // B resolves first.
    await act(async () => {
      fastB.resolve([{ userEmail: 'b@example.com', role: 'member' }]);
    });
    await waitFor(() => {
      expect(result.current.members).toEqual([{ userEmail: 'b@example.com', role: 'member' }]);
    });

    // A resolves afterwards and must be discarded.
    await act(async () => {
      slowA.resolve([{ userEmail: 'a@example.com', role: 'member' }]);
    });
    expect(result.current.members).toEqual([{ userEmail: 'b@example.com', role: 'member' }]);
    expect(result.current.selectedTeamId).toBe('team-b');
  });

  it('does not let a stale failure clear the newer request’s spinner', async () => {
    const slowA = deferred<TeamMember[]>();
    const fastB = deferred<TeamMember[]>();
    mocked.listTeamMembers.mockReturnValueOnce(slowA.promise).mockReturnValueOnce(fastB.promise);

    const { result } = renderHook(() => useTeams(onError));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.selectTeam('team-a');
    });
    act(() => {
      result.current.selectTeam('team-b');
    });
    await act(async () => {
      fastB.resolve([]);
    });
    await waitFor(() => {
      expect(result.current.membersLoading).toBe(false);
    });

    // Team A's request now rejects. It must not report an error, and must not
    // touch the spinner that already belongs to a settled newer request.
    const before = onError.mock.calls.length;
    await act(async () => {
      slowA.reject(new Error('stale team A failure'));
    });
    expect(onError.mock.calls.length).toBe(before);
    expect(result.current.membersLoading).toBe(false);
  });

  it('clears members, accounts, and spinners when the selection is cleared', async () => {
    mocked.listTeamMembers.mockResolvedValue([{ userEmail: 'a@example.com', role: 'member' }]);
    mocked.listTeamAccounts.mockResolvedValue(['123456789012']);
    const { result } = renderHook(() => useTeams(onError));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.selectTeam('team-a');
    });
    await waitFor(() => expect(result.current.members).toHaveLength(1));

    await act(async () => {
      result.current.selectTeam(null);
    });

    expect(result.current.selectedTeamId).toBeNull();
    expect(result.current.members).toEqual([]);
    expect(result.current.accounts).toEqual([]);
    expect(result.current.membersLoading).toBe(false);
    expect(result.current.accountsLoading).toBe(false);
  });

  it('discards an in-flight response after the selection is cleared', async () => {
    // Clearing the selection must retire the pending request, or team A's
    // members repopulate the panel the user just dismissed.
    const pending = deferred<TeamMember[]>();
    mocked.listTeamMembers.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useTeams(onError));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.selectTeam('team-a');
    });
    await act(async () => {
      result.current.selectTeam(null);
    });
    await act(async () => {
      pending.resolve([{ userEmail: 'a@example.com', role: 'member' }]);
    });

    expect(result.current.members).toEqual([]);
  });

  it('does not load anything when a team is already selected at mount', async () => {
    const { result } = renderHook(() => useTeams(onError));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocked.listTeamMembers).not.toHaveBeenCalled();
  });

  it('creates a team and refreshes the list', async () => {
    mocked.createTeam.mockResolvedValue(TEAM_A);
    mocked.listTeams.mockResolvedValueOnce([]).mockResolvedValue([TEAM_A]);
    const { result } = renderHook(() => useTeams(onError));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createTeam('Alpha');
    });

    expect(mocked.createTeam).toHaveBeenCalledWith('Alpha');
    await waitFor(() => {
      expect(result.current.teams).toEqual([TEAM_A]);
    });
  });

  it('clears the selection when the selected team is deleted', async () => {
    // Otherwise the members panel stays open showing a team that no longer
    // exists.
    mocked.listTeamMembers.mockResolvedValue([]);
    const { result } = renderHook(() => useTeams(onError));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      result.current.selectTeam('team-a');
    });

    mocked.deleteTeam.mockResolvedValue(undefined);
    mocked.listTeams.mockResolvedValue([]);
    await act(async () => {
      await result.current.deleteTeam('team-a');
    });

    expect(mocked.deleteTeam).toHaveBeenCalledWith('team-a');
    expect(result.current.selectedTeamId).toBeNull();
    expect(result.current.members).toEqual([]);
  });

  it('keeps the selection when a different team is deleted', async () => {
    mocked.deleteTeam.mockResolvedValue(undefined);
    mocked.listTeams.mockResolvedValue([TEAM_A, TEAM_B]);
    const { result } = renderHook(() => useTeams(onError));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      result.current.selectTeam('team-a');
    });

    await act(async () => {
      await result.current.deleteTeam('team-b');
    });

    expect(result.current.selectedTeamId).toBe('team-a');
  });

  it('refreshes the member list after a membership mutation', async () => {
    mocked.listTeamMembers.mockResolvedValue([]);
    const { result } = renderHook(() => useTeams(onError));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      result.current.selectTeam('team-a');
    });
    vi.mocked(mocked.listTeamMembers).mockClear();

    mocked.addTeamMember.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.addMember('team-a', 'new@example.com', 'member');
    });

    expect(mocked.addTeamMember).toHaveBeenCalledWith('team-a', 'new@example.com', 'member');
    expect(mocked.listTeamMembers).toHaveBeenCalledWith('team-a');
  });

  it('surfaces a mutation failure to the caller rather than swallowing it', async () => {
    // The TeamsTab wrapper relies on this rejecting so it can toast the message.
    mocked.addTeamMember.mockRejectedValue(new Error('not permitted'));
    const { result } = renderHook(() => useTeams(onError));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(result.current.addMember('team-a', 'new@example.com', 'member')).rejects.toThrow('not permitted');
  });

  it('does not warn about updating state after unmount', async () => {
    // A pending request that resolves after unmount must be discarded. React
    // logs a warning when it is not, which is the signal this asserts on —
    // `useToast`'s suite covers the timer half with fake timers.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pending = deferred<TeamMember[]>();
    mocked.listTeamMembers.mockReturnValueOnce(pending.promise);

    const { result, unmount } = renderHook(() => useTeams(onError));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => {
      result.current.selectTeam('team-a');
    });
    unmount();

    await act(async () => {
      pending.resolve([{ userEmail: 'a@example.com', role: 'member' }]);
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});