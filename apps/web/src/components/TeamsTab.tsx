'use client';

import type { ShowMessage } from '../hooks/useToast';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useTeams } from '../hooks/useTeams';
import TeamListSection from './teams/TeamListSection';
import TeamMembersSection from './teams/TeamMembersSection';
import TeamAccountsSection from './teams/TeamAccountsSection';
import { cardStyle, inputStyle, btnBlueStyle } from './ui/theme';

const styles = {
  card: cardStyle,
  input: inputStyle,
  btnBlue: btnBlueStyle,
};

interface TeamsTabProps {
  showMessage: ShowMessage;
}

/**
 * Team workspace: the team list, and the selected team's settings, members, and
 * scoped AWS accounts.
 *
 * The three sections live in `teams/`; this file owns only the handlers and the
 * selection state they share. Each section clears its own form field on success,
 * so none of that state leaks back here.
 */
export default function TeamsTab({ showMessage }: TeamsTabProps) {
  const { t } = useTranslation();
  const notifyError = (message: string) => showMessage('error', message);
  const {
    teams,
    isLoading,
    selectedTeamId,
    members,
    accounts,
    membersLoading,
    accountsLoading,
    selectTeam: selectTeamInHook,
    createTeam: createTeamInHook,
    deleteTeam: deleteTeamInHook,
    renameTeam: renameTeamInHook,
    addMember: addMemberInHook,
    removeMember: removeMemberInHook,
    updateMemberRole: updateMemberRoleInHook,
    addAccount: addAccountInHook,
    removeAccount: removeAccountInHook,
  } = useTeams(notifyError);

  const [renameTeamName, setRenameTeamName] = useState('');
  const selectedTeam = teams.find((tm) => tm.teamId === selectedTeamId);

  const selectTeam = (teamId: string) => {
    selectTeamInHook(teamId);
    const team = teams.find((tm) => tm.teamId === teamId);
    setRenameTeamName(team?.teamName ?? '');
  };

  const actions = useAsyncAction(showMessage);

  /**
   * Run a mutation and report the outcome. Resolves either way, never rejects:
   * the sections clear their own form field on resolve, and a rejected promise
   * there would leave an unhandled rejection behind.
   */
  const run = async (action: () => Promise<unknown>, success: string, failure: string): Promise<void> => {
    await actions.run('teams', action, { successMessage: success, errorFallback: failure });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <TeamListSection
        teams={teams}
        isLoading={isLoading}
        selectedTeamId={selectedTeamId}
        onSelect={selectTeam}
        onCreate={(name) =>
          run(
            () => createTeamInHook(name),
            t('teams.created', 'Team created successfully'),
            t('teams.createFailed', 'Failed to create team'),
          )
        }
        onDelete={(teamId) =>
          run(
            () => deleteTeamInHook(teamId),
            t('teams.deleted', 'Team deleted successfully'),
            t('teams.deleteFailed', 'Failed to delete team'),
          )
        }
      />

      {selectedTeam && (
        <>
          <div style={styles.card}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>
              {t('teams.settingsTitle', 'Team Settings — {{name}}', { name: selectedTeam.teamName })}
            </h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = renameTeamName.trim();
                if (!selectedTeamId || !name) return;
                void run(
                  () => renameTeamInHook(selectedTeamId, name),
                  t('teams.renamed', 'Team renamed successfully'),
                  t('teams.renameFailed', 'Failed to rename team'),
                );
              }}
              style={{ display: 'flex', gap: '12px', alignItems: 'center' }}
            >
              <div style={{ flex: 1 }}>
                <input
                  type="text"
                  placeholder={t('teams.newNamePlaceholder', 'New team name')}
                  value={renameTeamName}
                  onChange={(e) => setRenameTeamName(e.target.value)}
                  style={styles.input}
                />
              </div>
              <button
                type="submit"
                disabled={!renameTeamName.trim() || renameTeamName.trim() === selectedTeam.teamName}
                style={{
                  ...styles.btnBlue,
                  opacity: !renameTeamName.trim() || renameTeamName.trim() === selectedTeam.teamName ? 0.5 : 1,
                  cursor: !renameTeamName.trim() || renameTeamName.trim() === selectedTeam.teamName ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (renameTeamName.trim() && renameTeamName.trim() !== selectedTeam.teamName)
                    e.currentTarget.style.background = '#1d4ed8';
                }}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#2563eb')}
              >
                {t('common.rename', 'Rename')}
              </button>
            </form>
          </div>

          <TeamMembersSection
            members={members}
            isLoading={membersLoading}
            onAdd={(email, role) =>
              run(
                () => (selectedTeamId ? addMemberInHook(selectedTeamId, email, role) : Promise.resolve()),
                t('teams.memberAdded', 'Member added successfully'),
                t('teams.memberAddFailed', 'Failed to add member'),
              )
            }
            onRemove={(email) =>
              run(
                () => (selectedTeamId ? removeMemberInHook(selectedTeamId, email) : Promise.resolve()),
                t('teams.memberRemoved', 'Member removed successfully'),
                t('teams.memberRemoveFailed', 'Failed to remove member'),
              )
            }
            onUpdateRole={(email, role) => {
              if (!selectedTeamId) return;
              void run(
                () => updateMemberRoleInHook(selectedTeamId, email, role),
                t('teams.roleUpdated', 'Role updated successfully'),
                t('teams.roleUpdateFailed', 'Failed to update role'),
              );
            }}
          />

          <TeamAccountsSection
            accounts={accounts}
            isLoading={accountsLoading}
            onAdd={(accountId) =>
              run(
                () => (selectedTeamId ? addAccountInHook(selectedTeamId, accountId) : Promise.resolve()),
                t('teams.accountAdded', 'Account added to team'),
                t('teams.accountAddFailed', 'Failed to add account'),
              )
            }
            onRemove={(accountId) =>
              run(
                () => (selectedTeamId ? removeAccountInHook(selectedTeamId, accountId) : Promise.resolve()),
                t('teams.accountRemoved', 'Account removed from team'),
                t('teams.accountRemoveFailed', 'Failed to remove account'),
              )
            }
          />
        </>
      )}
    </div>
  );
}
