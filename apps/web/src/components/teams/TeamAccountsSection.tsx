'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusInput from '../ui/FocusInput';
import Spinner from '../ui/Spinner';
import { cardStyle, inputStyle, btnGreenStyle, btnSmallStyle } from '../ui/theme';

interface TeamAccountsSectionProps {
  accounts: string[];
  isLoading: boolean;
  onAdd: (awsAccountId: string) => Promise<void>;
  onRemove: (awsAccountId: string) => Promise<void>;
}

const styles = {
  card: cardStyle,
  input: inputStyle,
  btnGreen: btnGreenStyle,
  btnSmall: btnSmallStyle,
};

/**
 * The AWS accounts scoped to the selected team, and its add-account form.
 *
 * Split out of `TeamsTab`, which was 495 lines of three unrelated forms, two
 * tables, and eight handlers.
 */
export default function TeamAccountsSection({ accounts, isLoading, onAdd, onRemove }: TeamAccountsSectionProps) {
  const { t } = useTranslation();
  const [accountId, setAccountId] = useState('');

  return (
    <div style={styles.card}>
      <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>{t('teams.accountsHeading', 'AWS Accounts')}</h3>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onAdd(accountId.trim()).then(() => setAccountId(''));
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
          style={{ ...styles.btnGreen, opacity: accountId.trim() ? 1 : 0.5, cursor: accountId.trim() ? 'pointer' : 'not-allowed' }}
          onMouseEnter={(e) => {
            if (accountId.trim()) e.currentTarget.style.background = '#15803d';
          }}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#16a34a')}
        >
          {t('teams.addAccount', 'Add Account')}
        </button>
      </form>

      {isLoading && <Spinner size={20} />}

      {!isLoading && accounts.length === 0 && (
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#6b7280', fontSize: '14px' }}>
          {t('teams.noAccounts', 'No accounts assigned yet. Add one above.')}
        </div>
      )}

      {!isLoading && accounts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {accounts.map((acct) => (
            <div
              key={acct}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#252d3d', borderRadius: '8px' }}
            >
              <span className="font-mono" style={{ color: '#d1d5db' }}>
                {acct}
              </span>
              <button
                onClick={() => void onRemove(acct)}
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
  );
}