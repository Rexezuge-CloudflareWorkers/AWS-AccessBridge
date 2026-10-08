'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Team } from '@aws-access-bridge/shared';
import { formatUnixDate } from '../../lib/format';
import { DEFAULT_TEAM_ID } from '../../lib/constants';
import FocusInput from '../ui/FocusInput';
import Spinner from '../ui/Spinner';
import { cardStyle, btnGreenStyle, btnSmallStyle } from '../ui/theme';

interface TeamListSectionProps {
  teams: Team[];
  isLoading: boolean;
  selectedTeamId: string | null;
  onSelect: (teamId: string) => void;
  onCreate: (teamName: string) => Promise<void>;
  onDelete: (teamId: string) => Promise<void>;
}

const styles = {
  card: cardStyle,
  btnGreen: btnGreenStyle,
  btnSmall: btnSmallStyle,
};

/**
 * The create-team form and the selectable team list.
 *
 * Split out of `TeamsTab`, which was 495 lines of three unrelated forms, two
 * tables, and eight handlers.
 */
export default function TeamListSection({ teams, isLoading, selectedTeamId, onSelect, onCreate, onDelete }: TeamListSectionProps) {
  const { t, i18n } = useTranslation();
  const [teamName, setTeamName] = useState('');

  return (
    <>
      <div style={styles.card}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>{t('teams.createHeading', 'Create Team')}</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onCreate(teamName.trim()).then(() => setTeamName(''));
          }}
          style={{ display: 'flex', gap: '12px', alignItems: 'center' }}
        >
          <div style={{ flex: 1 }}>
            <FocusInput
              type="text"
              placeholder={t('teams.namePlaceholder', 'Team name')}
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={!teamName.trim()}
            style={{
              ...styles.btnGreen,
              opacity: teamName.trim() ? 1 : 0.5,
              cursor: teamName.trim() ? 'pointer' : 'not-allowed',
            }}
            onMouseEnter={(e) => {
              if (teamName.trim()) e.currentTarget.style.background = '#15803d';
            }}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#16a34a')}
          >
            {t('teams.createHeading', 'Create Team')}
          </button>
        </form>
      </div>

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
            {teams.map((team) => {
              const isDefault = team.teamId === DEFAULT_TEAM_ID;
              return (
                <div
                  key={team.teamId}
                  onClick={() => onSelect(team.teamId)}
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
                      void onDelete(team.teamId);
                    }}
                    disabled={isDefault}
                    title={isDefault ? t('teams.defaultLocked', 'The default team cannot be deleted') : undefined}
                    style={{
                      ...styles.btnSmall,
                      background: isDefault ? '#4b5563' : '#dc2626',
                      cursor: isDefault ? 'not-allowed' : 'pointer',
                      opacity: isDefault ? 0.6 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!isDefault) e.currentTarget.style.background = '#b91c1c';
                    }}
                    onMouseLeave={(e) => (e.currentTarget.style.background = isDefault ? '#4b5563' : '#dc2626')}
                  >
                    {t('common.delete', 'Delete')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
