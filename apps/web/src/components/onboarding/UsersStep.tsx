'use client';

import { useTranslation } from 'react-i18next';
import type { OnboardingWizard } from '../../hooks/useOnboardingWizard';
import { getBtnSuccess, getInputStyle, wizardStyles } from './wizardStyles';

/**
 * Step 5: user assignment (extracted from `OnboardingWizard.tsx` god file).
 */
export default function UsersStep({ wizard }: { wizard: OnboardingWizard }) {
  const { t } = useTranslation();
  return (
    <div style={wizardStyles.card}>
      <div style={wizardStyles.cardInner}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'white' }}>{t('onboarding.assignTitle', 'Assign Users')}</h3>
        <p className="text-sm" style={{ color: '#9ca3af' }}>
          {t('onboarding.assignHint', 'Enter email addresses of users to grant access to the selected roles.')}
        </p>
        {wizard.userEmails.map((email, i) => (
          <div key={i} style={{ display: 'flex', gap: '8px' }}>
            <input
              type="email"
              placeholder={t('admin.emailPlaceholder', 'user@example.com')}
              value={email}
              onChange={(e) => {
                const next = [...wizard.userEmails];
                next[i] = e.target.value;
                wizard.setUserEmails(next);
              }}
              style={getInputStyle(wizard.focusedInput, wizardStyles, `email-${i}`)}
              onFocus={() => wizard.setFocusedInput(`email-${i}`)}
              onBlur={() => wizard.setFocusedInput(null)}
            />
            {wizard.userEmails.length > 1 && (
              <button
                onClick={() => wizard.setUserEmails(wizard.userEmails.filter((_, j) => j !== i))}
                style={{ color: '#f87171', padding: '0 8px', background: 'none', border: 'none', cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#fca5a5')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#f87171')}
              >
                X
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => wizard.setUserEmails([...wizard.userEmails, ''])}
          className="text-sm"
          style={{ color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#93bbfd')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#60a5fa')}
        >
          {t('onboarding.addUser', '+ Add another user')}
        </button>
        <p className="text-sm" style={{ color: '#9ca3af' }}>
          {t('onboarding.grantingTo', 'Granting access to: {{roles}} in account {{account}}', {
            roles: Array.from(wizard.selectedRoles).join(', '),
            account: wizard.awsAccountId,
          })}
        </p>
        {wizard.accessGranted && (
          <p className="text-sm" style={{ color: '#4ade80' }}>
            {t('onboarding.accessGranted', 'Access granted successfully.')}
          </p>
        )}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={wizard.handleGrantAccess}
            disabled={wizard.isLoading || wizard.userEmails.every((e) => !e.trim()) || wizard.selectedRoles.size === 0}
            className="font-medium"
            style={getBtnSuccess(
              wizardStyles,
              wizard.isLoading || wizard.userEmails.every((e) => !e.trim()) || wizard.selectedRoles.size === 0,
            )}
          >
            {wizard.isLoading ? t('onboarding.granting', 'Granting...') : t('onboarding.grantAccess', 'Grant Access')}
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '16px' }}>
          <button
            onClick={() => wizard.setStep(3)}
            className="font-medium"
            style={wizardStyles.btnSecondary}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#4b5563')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#374151')}
          >
            {t('onboarding.back', 'Back')}
          </button>
          <button onClick={() => wizard.setStep(5)} className="font-medium" style={wizardStyles.btnSuccess}>
            {t('onboarding.next', 'Next')}
          </button>
        </div>
      </div>
    </div>
  );
}
