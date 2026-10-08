'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { afterSuccess } from '../lib/asyncAction';
import { useResource } from './useResource';
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
  type TeamRole,
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
  /**
   * Re-reads the *selected* team's members; resolves at once with nothing selected.
   */
  refreshMembers: () => Promise<void>;
  /**
   * Re-reads the *selected* team's accounts; resolves at once with nothing selected.
   */
  refreshAccounts: () => Promise<void>;
  createTeam: (teamName: string) => Promise<Team>;
  deleteTeam: (teamId: string) => Promise<void>;
  renameTeam: (teamId: string, teamName: string) => Promise<void>;
  addMember: (teamId: string, userEmail: string, role: TeamRole) => Promise<void>;
  removeMember: (teamId: string, userEmail: string) => Promise<void>;
  updateMemberRole: (teamId: string, userEmail: string, role: TeamRole) => Promise<void>;
  addAccount: (teamId: string, awsAccountId: string) => Promise<void>;
  removeAccount: (teamId: string, awsAccountId: string) => Promise<void>;
}

// Module-level so the "no data yet" answer keeps one identity across renders.
const NO_TEAMS: Team[] = [];
const NO_MEMBERS: TeamMember[] = [];
const NO_ACCOUNTS: string[] = [];

/**
 * Teams domain hook (vertical slice). Previously `TeamsTab.tsx` (579
 * lines) held 11× `apiCall`, 10+ `useState`, and all CRUD inline.
 *
 * Three `useResource`s carry the reads. The members and accounts fetchers are
 * keyed on the selected team, which is what makes switching teams safe: a new
 * selection is a new fetcher, so the slower earlier request is retired by the
 * request guard inside `useResource` rather than rendering team A's members under
 * team B. A `null` selection is a `null` fetcher, which clears the data and
 * retires anything in flight.
 *
 * A failed *read* reaches `onError` as a toast. A failed *mutation* is not caught
 * here — it rejects to the caller, which toasts it.
 */
function useTeams(onError: (message: string) => void): UseTeamsResult {
  const { t } = useTranslation();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  // `useResource` also passes the raw error, which a toast has no use for.
  const reportError = (message: string): void => onError(message);

  const teamsResource = useResource(listTeams, {
    errorFallback: t('teams.loadError', 'Failed to load teams'),
    onError: reportError,
  });

  const membersFetcher = useMemo(() => (selectedTeamId ? () => listTeamMembers(selectedTeamId) : null), [selectedTeamId]);
  const membersResource = useResource(membersFetcher, {
    errorFallback: t('teams.membersLoadFailed', 'Failed to load members'),
    onError: reportError,
  });

  const accountsFetcher = useMemo(() => (selectedTeamId ? () => listTeamAccounts(selectedTeamId) : null), [selectedTeamId]);
  const accountsResource = useResource(accountsFetcher, {
    errorFallback: t('teams.accountsLoadFailed', 'Failed to load accounts'),
    onError: reportError,
  });

  const refreshTeams = teamsResource.refresh;
  const refreshMembers = membersResource.refresh;
  const refreshAccounts = accountsResource.refresh;

  const selectTeam = useCallback((teamId: string | null) => {
    setSelectedTeamId(teamId);
  }, []);

  const mutations = useMemo(
    () => ({
      createTeam: afterSuccess(createTeam, refreshTeams),
      renameTeam: afterSuccess(renameTeam, refreshTeams),
      addMember: afterSuccess(addTeamMember, refreshMembers),
      removeMember: afterSuccess(removeTeamMember, refreshMembers),
      updateMemberRole: afterSuccess(updateTeamMemberRole, refreshMembers),
      addAccount: afterSuccess(addTeamAccount, refreshAccounts),
      removeAccount: afterSuccess(removeTeamAccount, refreshAccounts),
    }),
    [refreshTeams, refreshMembers, refreshAccounts],
  );

  const deleteTeamAndRefresh = useCallback(
    async (teamId: string) => {
      await deleteTeam(teamId);
      if (selectedTeamId === teamId) {
        selectTeam(null);
      }
      await refreshTeams();
    },
    [refreshTeams, selectTeam, selectedTeamId],
  );

  return {
    teams: teamsResource.data ?? NO_TEAMS,
    isLoading: teamsResource.isFetching,
    selectedTeamId,
    members: membersResource.data ?? NO_MEMBERS,
    accounts: accountsResource.data ?? NO_ACCOUNTS,
    membersLoading: membersResource.isFetching,
    accountsLoading: accountsResource.isFetching,
    selectTeam,
    refreshTeams,
    refreshMembers,
    refreshAccounts,
    ...mutations,
    deleteTeam: deleteTeamAndRefresh,
  };
}

export { useTeams };
export type { UseTeamsResult };
