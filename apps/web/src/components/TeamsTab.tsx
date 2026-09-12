'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { formatUnixDate } from '../lib/format';
import FocusInput from './ui/FocusInput';
import Spinner from './ui/Spinner';
import { apiCall } from '../lib/api';
import {
  cardStyle,
  inputStyle,
  tableCardStyle,
  thStyle,
  tdStyle,
  btnBlueStyle,
  btnGreenStyle,
  btnRedStyle,
  btnSmallStyle,
} from './ui/theme';

const styles = {
  card: cardStyle,
  input: inputStyle,
  btnBlue: btnBlueStyle,
  btnGreen: btnGreenStyle,
  btnRed: btnRedStyle,
  btnSmall: btnSmallStyle,
  tableCard: tableCardStyle,
  th: thStyle,
  td: tdStyle,
};

const DEFAULT_TEAM_ID = '00000000-0000-0000-0000-000000000000';

interface Team {
  teamId: string;
  teamName: string;
  createdBy: string;
  createdAt: number;
}

interface TeamMember {
  teamId: string;
  userEmail: string;
  role: string;
  joinedAt: number;
}

interface TeamsTabProps {
  showMessage: (type: 'success' | 'error', text: string) => void;
}

export default function TeamsTab({ showMessage }: TeamsTabProps) {
  const { t, i18n } = useTranslation();
  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);

  // Forms
  const [createTeamName, setCreateTeamName] = useState('');
  const [renameTeamName, setRenameTeamName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState('member');
  const [accountId, setAccountId] = useState('');

  const fetchTeams = useCallback(async () => {
    setIsLoading(true);
    const result = await apiCall('/user/admin/teams', 'GET');
    if (result.ok && result.data) {
      setTeams((result.data as { teams: Team[] }).teams || []);
    } else {
      showMessage('error', result.error || 'Failed to load teams');
    }
    setIsLoading(false);
  }, [showMessage]);

  useEffect(() => {
    apiCall('/user/admin/teams', 'GET')
      .then((result) => {
        if (result.ok && result.data) {
          setTeams((result.data as { teams: Team[] }).teams || []);
        } else {
          showMessage('error', result.error || t('teams.loadError', 'Failed to load teams'));
        }
        setIsLoading(false);
      })
      .catch(() => {
        showMessage('error', t('teams.loadError', 'Failed to load teams'));
        setIsLoading(false);
      });
  }, [showMessage, t]);

  const fetchMembers = useCallback(
    async (teamId: string) => {
      setMembersLoading(true);
      const result = await apiCall(`/user/admin/team/members?teamId=${teamId}`, 'GET');
      if (result.ok && result.data) {
        setMembers((result.data as { members: TeamMember[] }).members || []);
      } else {
        showMessage('error', result.error || t('teams.membersLoadFailed', 'Failed to load members'));
      }
      setMembersLoading(false);
    },
    [showMessage],
  );

  const fetchAccounts = useCallback(
    async (teamId: string) => {
      setAccountsLoading(true);
      const result = await apiCall(`/user/admin/team/accounts?teamId=${teamId}`, 'GET');
      if (result.ok && result.data) {
        setAccounts((result.data as { accountIds: string[] }).accountIds || []);
      } else {
        showMessage('error', result.error || t('teams.accountsLoadFailed', 'Failed to load accounts'));
      }
      setAccountsLoading(false);
    },
    [showMessage],
  );

  const selectTeam = useCallback(
    (teamId: string) => {
      setSelectedTeamId(teamId);
      setMembers([]);
      setAccounts([]);
      const team = teams.find((t) => t.teamId === teamId);
      setRenameTeamName(team?.teamName || '');
      void fetchMembers(teamId);
      void fetchAccounts(teamId);
    },
    [teams, fetchMembers, fetchAccounts],
  );

  const handleCreateTeam = async () => {
    if (!createTeamName.trim()) return;
    const result = await apiCall('/user/admin/team', 'POST', { teamName: createTeamName.trim() });
    if (result.ok) {
      showMessage('success', t('teams.created', 'Team created successfully'));
      setCreateTeamName('');
      void fetchTeams();
    } else {
      showMessage('error', result.error || t('teams.createFailed', 'Failed to create team'));
    }
  };

  const handleDeleteTeam = async (teamId: string) => {
    const result = await apiCall('/user/admin/team', 'DELETE', { teamId });
    if (result.ok) {
      showMessage('success', t('teams.deleted', 'Team deleted successfully'));
      if (selectedTeamId === teamId) {
        setSelectedTeamId(null);
        setMembers([]);
        setAccounts([]);
      }
      void fetchTeams();
    } else {
      showMessage('error', result.error || t('teams.deleteFailed', 'Failed to delete team'));
    }
  };

  const handleRenameTeam = async () => {
    if (!selectedTeamId || !renameTeamName.trim()) return;
    const result = await apiCall('/user/admin/team/name', 'PUT', { teamId: selectedTeamId, teamName: renameTeamName.trim() });
    if (result.ok) {
      showMessage('success', t('teams.renamed', 'Team renamed successfully'));
      void fetchTeams();
    } else {
      showMessage('error', result.error || t('teams.renameFailed', 'Failed to rename team'));
    }
  };

  const handleAddMember = async () => {
    if (!selectedTeamId || !memberEmail.trim()) return;
    const result = await apiCall('/user/admin/team/member', 'POST', {
      teamId: selectedTeamId,
      userEmail: memberEmail.trim(),
      role: memberRole,
    });
    if (result.ok) {
      showMessage('success', t('teams.memberAdded', 'Member added successfully'));
      setMemberEmail('');
      setMemberRole('member');
      void fetchMembers(selectedTeamId);
    } else {
      showMessage('error', result.error || t('teams.memberAddFailed', 'Failed to add member'));
    }
  };

  const handleRemoveMember = async (email: string) => {
    if (!selectedTeamId) return;
    const result = await apiCall('/user/admin/team/member', 'DELETE', { teamId: selectedTeamId, userEmail: email });
    if (result.ok) {
      showMessage('success', t('teams.memberRemoved', 'Member removed successfully'));
      void fetchMembers(selectedTeamId);
    } else {
      showMessage('error', result.error || t('teams.memberRemoveFailed', 'Failed to remove member'));
    }
  };

  const handleUpdateRole = async (email: string, newRole: string) => {
    if (!selectedTeamId) return;
    const result = await apiCall('/user/admin/team/member/role', 'PUT', {
      teamId: selectedTeamId,
      userEmail: email,
      role: newRole,
    });
    if (result.ok) {
      showMessage('success', t('teams.roleUpdated', 'Role updated successfully'));
      void fetchMembers(selectedTeamId);
    } else {
      showMessage('error', result.error || t('teams.roleUpdateFailed', 'Failed to update role'));
    }
  };

  const handleAddAccount = async () => {
    if (!selectedTeamId || !accountId.trim()) return;
    const result = await apiCall('/user/admin/team/account', 'POST', { teamId: selectedTeamId, awsAccountId: accountId.trim() });
    if (result.ok) {
      showMessage('success', t('teams.accountAdded', 'Account added to team'));
      setAccountId('');
      void fetchAccounts(selectedTeamId);
    } else {
      showMessage('error', result.error || t('teams.accountAddFailed', 'Failed to add account'));
    }
  };

  const handleRemoveAccount = async (awsAccountId: string) => {
    if (!selectedTeamId) return;
    const result = await apiCall('/user/admin/team/account', 'DELETE', { teamId: selectedTeamId, awsAccountId });
    if (result.ok) {
      showMessage('success', t('teams.accountRemoved', 'Account removed from team'));
      void fetchAccounts(selectedTeamId);
    } else {
      showMessage('error', result.error || t('teams.accountRemoveFailed', 'Failed to remove account'));
    }
  };

  const selectedTeam = teams.find((t) => t.teamId === selectedTeamId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Create Team */}
      <div style={styles.card}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>Create Team</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreateTeam();
          }}
          style={{ display: 'flex', gap: '12px', alignItems: 'center' }}
        >
          <div style={{ flex: 1 }}>
            <FocusInput
              type="text"
              placeholder={t('teams.namePlaceholder', 'Team name')}
              value={createTeamName}
              onChange={(e) => setCreateTeamName(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={!createTeamName.trim()}
            style={{
              ...styles.btnGreen,
              opacity: createTeamName.trim() ? 1 : 0.5,
              cursor: createTeamName.trim() ? 'pointer' : 'not-allowed',
            }}
            onMouseEnter={(e) => {
              if (createTeamName.trim()) e.currentTarget.style.background = '#15803d';
            }}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#16a34a')}
          >
            {t('teams.createHeading', 'Create Team')}
          </button>
        </form>
      </div>

      {/* Team List */}
      <div style={styles.card}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>{t('teams.title', 'Teams')}</h3>

        {isLoading && <Spinner size={24} />}

        {!isLoading && teams.length === 0 && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: '#6b7280' }}>
            {t('teams.noTeams', 'No teams found. Create one above.')}
          </div>
        )}

        {!isLoading && teams.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {teams.map((team) => (
              <div
                key={team.teamId}
                onClick={() => selectTeam(team.teamId)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  background: selectedTeamId === team.teamId ? 'rgba(37,99,235,0.15)' : '#252d3d',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border: selectedTeamId === team.teamId ? '1px solid rgba(37,99,235,0.4)' : '1px solid transparent',
                  transition: 'all 0.15s',
                }}
              >
                <div>
                  <div style={{ fontWeight: 500, color: '#ffffff' }}>{team.teamName}</div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                    Created by {team.createdBy} on {formatUnixDate(team.createdAt, i18n.resolvedLanguage ?? 'en')}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDeleteTeam(team.teamId);
                  }}
                  disabled={team.teamId === DEFAULT_TEAM_ID}
                  title={team.teamId === DEFAULT_TEAM_ID ? t('teams.defaultLocked', 'The default team cannot be deleted') : undefined}
                  style={{
                    ...styles.btnSmall,
                    background: team.teamId === DEFAULT_TEAM_ID ? '#4b5563' : '#dc2626',
                    cursor: team.teamId === DEFAULT_TEAM_ID ? 'not-allowed' : 'pointer',
                    opacity: team.teamId === DEFAULT_TEAM_ID ? 0.6 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (team.teamId !== DEFAULT_TEAM_ID) e.currentTarget.style.background = '#b91c1c';
                  }}
                  onMouseLeave={(e) => {
                    if (team.teamId !== DEFAULT_TEAM_ID) e.currentTarget.style.background = '#dc2626';
                  }}
                >
                  {t('common.delete', 'Delete')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Team Detail */}
      {selectedTeam && (
        <>
          {/* Rename Team */}
          <div style={styles.card}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>
              {t('teams.settingsTitle', 'Team Settings — {{name}}', { name: selectedTeam.teamName })}
            </h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleRenameTeam();
              }}
              style={{ display: 'flex', gap: '12px', alignItems: 'center' }}
            >
              <div style={{ flex: 1 }}>
                <FocusInput
                  type="text"
                  placeholder={t('teams.newNamePlaceholder', 'New team name')}
                  value={renameTeamName}
                  onChange={(e) => setRenameTeamName(e.target.value)}
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

          {/* Members */}
          <div style={styles.card}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>{t('teams.membersHeading', 'Members')}</h3>

            {/* Add member form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleAddMember();
              }}
              style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}
            >
              <div style={{ flex: 1 }}>
                <FocusInput
                  type="email"
                  placeholder={t('teams.emailPlaceholder', 'User email')}
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                />
              </div>
              <select
                value={memberRole}
                onChange={(e) => setMemberRole(e.target.value)}
                style={{
                  ...styles.input,
                  width: 'auto',
                  padding: '12px 16px',
                  cursor: 'pointer',
                }}
              >
                <option value="member">{t('teams.roleMember', 'Member')}</option>
                <option value="admin">{t('teams.roleAdmin', 'Admin')}</option>
              </select>
              <button
                type="submit"
                disabled={!memberEmail.trim()}
                style={{
                  ...styles.btnGreen,
                  opacity: memberEmail.trim() ? 1 : 0.5,
                  cursor: memberEmail.trim() ? 'pointer' : 'not-allowed',
                }}
                onMouseEnter={(e) => {
                  if (memberEmail.trim()) e.currentTarget.style.background = '#15803d';
                }}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#16a34a')}
              >
                {t('teams.addMember', 'Add Member')}
              </button>
            </form>

            {membersLoading && <Spinner size={20} />}

            {!membersLoading && members.length === 0 && (
              <div style={{ textAlign: 'center', padding: '16px 0', color: '#6b7280', fontSize: '14px' }}>
                {t('teams.noMembers', 'No members yet. Add one above.')}
              </div>
            )}

            {!membersLoading && members.length > 0 && (
              <div style={styles.tableCard}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={styles.th}>{t('teams.emailHeader', 'Email')}</th>
                      <th style={styles.th}>{t('teams.roleHeader', 'Role')}</th>
                      <th style={styles.th}>{t('teams.addedHeader', 'Added')}</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>{t('teams.actionsHeader', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.userEmail}>
                        <td style={{ ...styles.td, color: '#d1d5db' }}>{m.userEmail}</td>
                        <td style={styles.td}>
                          <select
                            value={m.role}
                            onChange={(e) => handleUpdateRole(m.userEmail, e.target.value)}
                            style={{
                              background: '#252d3d',
                              border: '1px solid #374151',
                              borderRadius: '6px',
                              color: '#ffffff',
                              padding: '4px 8px',
                              cursor: 'pointer',
                              outline: 'none',
                            }}
                          >
                            <option value="member">{t('teams.roleMember', 'Member')}</option>
                            <option value="admin">{t('teams.roleAdmin', 'Admin')}</option>
                          </select>
                        </td>
                        <td style={{ ...styles.td, color: '#6b7280', fontSize: '13px' }}>
                          {formatUnixDate(m.joinedAt, i18n.resolvedLanguage ?? 'en')}
                        </td>
                        <td style={{ ...styles.td, textAlign: 'right' }}>
                          <button
                            onClick={() => handleRemoveMember(m.userEmail)}
                            style={{ ...styles.btnSmall, background: '#dc2626' }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#b91c1c')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = '#dc2626')}
                          >
                            {t('common.remove', 'Remove')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Accounts */}
          <div style={styles.card}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>{t('teams.accountsHeading', 'AWS Accounts')}</h3>

            {/* Add account form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleAddAccount();
              }}
              style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}
            >
              <div style={{ flex: 1 }}>
                <FocusInput
                  type="text"
                  placeholder={t('teams.accountPlaceholder', 'AWS Account ID (12 digits)')}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  pattern="[0-9]{12}"
                />
              </div>
              <button
                type="submit"
                disabled={!accountId.trim()}
                style={{
                  ...styles.btnGreen,
                  opacity: accountId.trim() ? 1 : 0.5,
                  cursor: accountId.trim() ? 'pointer' : 'not-allowed',
                }}
                onMouseEnter={(e) => {
                  if (accountId.trim()) e.currentTarget.style.background = '#15803d';
                }}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#16a34a')}
              >
                {t('teams.addAccount', 'Add Account')}
              </button>
            </form>

            {accountsLoading && <Spinner size={20} />}

            {!accountsLoading && accounts.length === 0 && (
              <div style={{ textAlign: 'center', padding: '16px 0', color: '#6b7280', fontSize: '14px' }}>
                {t('teams.noAccounts', 'No accounts assigned yet. Add one above.')}
              </div>
            )}

            {!accountsLoading && accounts.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {accounts.map((acct) => (
                  <div
                    key={acct}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 16px',
                      background: '#252d3d',
                      borderRadius: '8px',
                    }}
                  >
                    <span className="font-mono" style={{ color: '#d1d5db' }}>
                      {acct}
                    </span>
                    <button
                      onClick={() => handleRemoveAccount(acct)}
                      style={{ ...styles.btnSmall, background: '#dc2626' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#b91c1c')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '#dc2626')}
                    >
                      {t('common.remove', 'Remove')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
