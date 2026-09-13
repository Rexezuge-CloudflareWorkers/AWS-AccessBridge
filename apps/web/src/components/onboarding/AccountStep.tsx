'use client';

import { useTranslation } from 'react-i18next';
import type { OnboardingWizard } from '../../hooks/useOnboardingWizard';
import { getBtnPrimary, getBtnSuccess, getInputStyle, wizardStyles } from './wizardStyles';

/**
 * Step 1: AWS account (extracted from `OnboardingWizard.tsx` god file).
 */
export default function AccountStep({ wizard }: { wizard: OnboardingWizard }) {
  const { t } = useTranslation();
  return (
    <div style={wizardStyles.card}>
      <div style={wizardStyles.cardInner}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'white' }}>{t('onboarding.addAccount', 'Add AWS Account')}</h3>
        <p className="text-sm" style={{ color: '#9ca3af' }}>
          {t('onboarding.accountStepHint', 'Enter the 12-digit AWS Account ID and an optional nickname.')}
        </p>
        <input
          type="text"
          placeholder={t('admin.accountIdPlaceholder', 'AWS Account ID (12 digits)')}
          value={wizard.awsAccountId}
          onChange={(e) => wizard.setAwsAccountId(e.target.value)}
          style={getInputStyle(wizard.focusedInput, wizardStyles, 'accountId')}
          onFocus={() => wizard.setFocusedInput('accountId')}
          onBlur={() => wizard.setFocusedInput(null)}
          pattern="[0-9]{12}"
        />
        <input
          type="text"
          placeholder={t('onboarding.nicknamePlaceholder', 'Nickname (optional)')}
          value={wizard.nickname}
          onChange={(e) => wizard.setNickname(e.target.value)}
          style={getInputStyle(wizard.focusedInput, wizardStyles, 'nickname')}
          onFocus={() => wizard.setFocusedInput('nickname')}
          onBlur={() => wizard.setFocusedInput(null)}
        />
        {wizard.accountSaved && (
          <p className="text-sm" style={{ color: '#4ade80' }}>
            {t('onboarding.accountConfigured', 'Account configured.')}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button
            onClick={wizard.handleSaveAccount}
            disabled={wizard.isLoading || !/^\d{12}$/.test(wizard.awsAccountId)}
            className="font-medium"
            style={getBtnPrimary(wizardStyles, wizard.isLoading || !/^\d{12}$/.test(wizard.awsAccountId))}
          >
            {wizard.isLoading ? t('onboarding.saving', 'Saving...') : t('onboarding.saveAccount', 'Save Account')}
          </button>
          <button
            onClick={() => wizard.setStep(1)}
            disabled={!wizard.accountSaved}
            className="font-medium"
            style={getBtnSuccess(wizardStyles, !wizard.accountSaved)}
          >
            {t('onboarding.next', 'Next')}
          </button>
        </div>
      </div>
    </div>
  );
}
