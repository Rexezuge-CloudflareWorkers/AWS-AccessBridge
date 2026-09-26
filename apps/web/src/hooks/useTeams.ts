'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addTeamAccount,
  addTeamMember,
  createTeam,
  deleteTeam,
  listTeamAccounts,
  listTeamMembers,
  listTeams,
  removeTeamAccount,
  removeTeamMember,
  renameTeam,
  updateTeamMemberRole,
  type Team,
  type TeamMember,
} from '../services/teamsService';

interface UseTeamsResult {
  teams: Team[];
  isLoading: boolean;
  selectedTeamId: string | null;
  members: TeamMember[];
  accounts: string[];
  membersLoading: boolean;
  accountsLoading: boolean;
  selectTeam: (teamId: string | null) => void;
  refreshTeams: () => Promise<void>;
  refreshMembers: (teamId: string) => Promise<void>;
  refreshAccounts: (teamId: string) => Promise<void>;
  createTeam: (teamName: string) => Promise<Team>;
  deleteTeam: (teamId: string) => Promise<void>;
  renameTeam: (teamId: string, teamName: string) => Promise<void>;
  addMember: (teamId: string, userEmail: string, role: string) => Promise<void>;
  removeMember: (teamId: string, userEmail: string) => Promise<void>;
  updateMemberRole: (teamId: string, userEmail: string, role: string) => Promise<void>;
  addAccount: (teamId: string, awsAccountId: string) => Promise<void>;
  removeAccount: (teamId: string, awsAccountId: string) => Promise<void>;
}

/**
 * Teams domain hook (vertical slice). Previously `TeamsTab.tsx` (579
 * lines) held 11× `apiCall`, 10+ `useState`, and all CRUD inline.
 */
function useTeams(onError: (message: string) => void): UseTeamsResult {
  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  // Monotonic request ids: switching teams quickly fires overlapping requests,
  // and without a guard the slower earlier one can resolve last and render the
  // previously-selected team's members/accounts under the new selection.
  const membersRequestId = useRef(0);
  const accountsRequestId = useRef(0);

  const refreshTeams = useCallback(async () => {
    setIsLoading(true);
    try {
      setTeams(await listTeams());
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load teams');
    } finally {
      setIsLoading(false);
    }
  }, [onError]);

  const refreshMembers = useCallback(
    async (teamId: string) => {
      const requestId = ++membersRequestId.current;
      setMembersLoading(true);
      try {
        const result = await listTeamMembers(teamId);
        if (requestId === membersRequestId.current) {
          setMembers(result);
        }
      } catch (err) {
        if (requestId === membersRequestId.current) {
          onError(err instanceof Error ? err.message : 'Failed to load members');
        }
      } finally {
        if (requestId === membersRequestId.current) {
          setMembersLoading(false);
        }
      }
    },
    [onError],
  );

  const refreshAccounts = useCallback(
    async (teamId: string) => {
      const requestId = ++accountsRequestId.current;
      setAccountsLoading(true);
      try {
        const result = await listTeamAccounts(teamId);
        if (requestId === accountsRequestId.current) {
          setAccounts(result);
        }
      } catch (err) {
        if (requestId === accountsRequestId.current) {
          onError(err instanceof Error ? err.message : 'Failed to load accounts');
        }
      } finally {
        if (requestId === accountsRequestId.current) {
          setAccountsLoading(false);
        }
      }
    },
    [onError],
  );

  useEffect(() => {
    let cancelled = false;
    listTeams()
      .then((result) => {
        if (cancelled) return;
        setTeams(result);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        onErrorRef.current(err instanceof Error ? err.message : 'Failed to load teams');
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectTeam = useCallback(
    (teamId: string | null) => {
      setSelectedTeamId(teamId);
      if (teamId) {
        void refreshMembers(teamId).catch(() => undefined);
        void refreshAccounts(teamId).catch(() => undefined);
      } else {
        // Invalidate any in-flight request for the previously selected team so
        // it cannot repopulate members/accounts after the selection is cleared.
        membersRequestId.current += 1;
        accountsRequestId.current += 1;
        setMembers([]);
        setAccounts([]);
        setMembersLoading(false);
        setAccountsLoading(false);
      }
    },
    [refreshAccounts, refreshMembers],
  );

  return {
    teams,
    isLoading,
    selectedTeamId,
    members,
    accounts,
    membersLoading,
    accountsLoading,
    selectTeam,
    refreshTeams,
    refreshMembers,
    refreshAccounts,
    createTeam: useCallback(
      async (teamName: string) => {
        const team = await createTeam(teamName);
        await refreshTeams();
        return team;
      },
      [refreshTeams],
    ),
    deleteTeam: useCallback(
      async (teamId: string) => {
        await deleteTeam(teamId);
        if (selectedTeamId === teamId) {
          selectTeam(null);
        }
        await refreshTeams();
      },
      [refreshTeams, selectTeam, selectedTeamId],
    ),
    renameTeam: useCallback(
      async (teamId: string, teamName: string) => {
        await renameTeam(teamId, teamName);
        await refreshTeams();
      },
      [refreshTeams],
    ),
    addMember: useCallback(
      async (teamId: string, userEmail: string, role: string) => {
        await addTeamMember(teamId, userEmail, role);
        await refreshMembers(teamId);
      },
      [refreshMembers],
    ),
    removeMember: useCallback(
      async (teamId: string, userEmail: string) => {
        await removeTeamMember(teamId, userEmail);
        await refreshMembers(teamId);
      },
      [refreshMembers],
    ),
    updateMemberRole: useCallback(
      async (teamId: string, userEmail: string, role: string) => {
        await updateTeamMemberRole(teamId, userEmail, role);
        await refreshMembers(teamId);
      },
      [refreshMembers],
    ),
    addAccount: useCallback(
      async (teamId: string, awsAccountId: string) => {
        await addTeamAccount(teamId, awsAccountId);
        await refreshAccounts(teamId);
      },
      [refreshAccounts],
    ),
    removeAccount: useCallback(
      async (teamId: string, awsAccountId: string) => {
        await removeTeamAccount(teamId, awsAccountId);
        await refreshAccounts(teamId);
      },
      [refreshAccounts],
    ),
  };
}

export { useTeams };
export type { UseTeamsResult };
