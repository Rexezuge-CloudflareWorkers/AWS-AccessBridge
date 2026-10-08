'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TeamMember } from '@aws-access-bridge/shared';
import { formatUnixDate } from '../../lib/format';
import { DEFAULT_TEAM_ROLE, isTeamRole } from '../../lib/teamRoles';
import type { TeamRole } from '../../services/teamsService';
import FocusInput from '../ui/FocusInput';
import Spinner from '../ui/Spinner';
import { cardStyle, inputStyle, tableCardStyle, thStyle, tdStyle, btnGreenStyle, btnSmallStyle } from '../ui/theme';

interface TeamMembersSectionProps {
  members: TeamMember[];
  isLoading: boolean;
  onAdd: (email: string, role: TeamRole) => Promise<void>;
  onRemove: (email: string) => Promise<void>;
  onUpdateRole: (email: string, role: TeamRole) => void;
}

const styles = {
  card: cardStyle,
  input: inputStyle,
  btnGreen: btnGreenStyle,
  btnSmall: btnSmallStyle,
  tableCard: tableCardStyle,
  th: thStyle,
  td: tdStyle,
};

/**
 * The members table and its add-member form.
 *
 * Split out of `TeamsTab` so each section reads on its own; the tab was 495 lines
 * of three unrelated forms, two tables, and eight handlers.
 */
export default function TeamMembersSection({ members, isLoading, onAdd, onRemove, onUpdateRole }: TeamMembersSectionProps) {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>(DEFAULT_TEAM_ROLE);

  return (
    <div style={styles.card}>
      <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>{t('teams.membersHeading', 'Members')}</h3>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onAdd(email.trim(), role).then(() => {
            setEmail('');
            setRole(DEFAULT_TEAM_ROLE);
          });
        }}
        style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}
      >
        <div style={{ flex: 1 }}>
          <FocusInput
            type="email"
            placeholder={t('teams.emailPlaceholder', 'User email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <select
          value={role}
          onChange={(e) => {
            if (isTeamRole(e.target.value)) setRole(e.target.value);
          }}
          style={{ ...styles.input, width: 'auto', padding: '12px 16px', cursor: 'pointer' }}
        >
          <option value="member">{t('teams.roleMember', 'Member')}</option>
          <option value="admin">{t('teams.roleAdmin', 'Admin')}</option>
        </select>
        <button
          type="submit"
          disabled={!email.trim()}
          style={{ ...styles.btnGreen, opacity: email.trim() ? 1 : 0.5, cursor: email.trim() ? 'pointer' : 'not-allowed' }}
          onMouseEnter={(e) => {
            if (email.trim()) e.currentTarget.style.background = '#15803d';
          }}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#16a34a')}
        >
          {t('teams.addMember', 'Add Member')}
        </button>
      </form>

      {isLoading && <Spinner size={20} />}

      {!isLoading && members.length === 0 && (
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#6b7280', fontSize: '14px' }}>
          {t('teams.noMembers', 'No members yet. Add one above.')}
        </div>
      )}

      {!isLoading && members.length > 0 && (
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
                      onChange={(e) => {
                        if (isTeamRole(e.target.value)) onUpdateRole(m.userEmail, e.target.value);
                      }}
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
                      onClick={() => void onRemove(m.userEmail)}
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
  );
}
