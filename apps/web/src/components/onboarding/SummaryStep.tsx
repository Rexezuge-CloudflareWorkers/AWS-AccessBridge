'use client';

import { useTranslation } from 'react-i18next';
import type { OnboardingWizard } from '../../hooks/useOnboardingWizard';
import { getBtnPrimary, wizardStyles } from './wizardStyles';

/**
 * Step 6: summary (extracted from `OnboardingWizard.tsx` god file).
 */
export default function SummaryStep({ wizard }: { wizard: OnboardingWizard }) {
  const { t } = useTranslation();
  return (
    <div style={wizardStyles.card}>
      <div style={wizardStyles.cardInner}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'white' }}>{t('onboarding.completeTitle', 'Setup Complete')}</h3>
        <div className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={wizardStyles.summaryItem}>
            <span style={{ color: '#9ca3af' }}>{t('onboarding.accountLabel', 'Account:')}</span>{' '}
            {wizard.nickname ? `${wizard.nickname} (${wizard.awsAccountId})` : wizard.awsAccountId}
          </div>
          <div style={wizardStyles.summaryItem}>
            <span style={{ color: '#9ca3af' }}>{t('onboarding.principalLabel', 'Principal:')}</span> {wizard.principalArn}
          </div>
          {wizard.intermediateRoleArn && (
            <div style={wizardStyles.summaryItem}>
              <span style={{ color: '#9ca3af' }}>{t('onboarding.chainLabel', 'Chain:')}</span> {wizard.principalArn} →{' '}
              {wizard.intermediateRoleArn}
            </div>
          )}
          <div style={wizardStyles.summaryItem}>
            <span style={{ color: '#9ca3af' }}>{t('onboarding.rolesLabel', 'Roles:')}</span> {Array.from(wizard.selectedRoles).join(', ')}
          </div>
          <div style={wizardStyles.summaryItem}>
            <span style={{ color: '#9ca3af' }}>{t('onboarding.usersLabel', 'Users:')}</span>{' '}
            {wizard.userEmails.filter((e) => e.trim()).join(', ') || t('onboarding.noneAssigned', '(none assigned)')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', paddingTop: '16px' }}>
          <button
            onClick={wizard.handleTestChain}
            disabled={wizard.isLoading}
            className="font-medium"
            style={getBtnPrimary(wizardStyles, wizard.isLoading)}
          >
            {wizard.isLoading ? t('onboarding.testingConnection', 'Testing...') : t('onboarding.testConnection', 'Test Connection')}
          </button>
          <button
            onClick={() => wizard.setStep(0)}
            className="font-medium"
            style={wizardStyles.btnSecondary}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#4b5563')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#374151')}
          >
            {t('onboarding.backToStart', 'Back to Start')}
          </button>
        </div>
        {wizard.chainTestResult && (
          <div className="text-sm" style={wizardStyles.chainResult}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {wizard.chainTestResult.map((r, i) => (
                <div key={i} style={{ color: r.status.startsWith('ok') ? '#4ade80' : '#f87171' }}>
                  {r.arn}: {r.status}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
