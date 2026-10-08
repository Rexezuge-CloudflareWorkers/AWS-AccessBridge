'use client';

import { useTranslation } from 'react-i18next';
import type { OnboardingWizard } from '../../hooks/useOnboardingWizard';
import WizardInput from './WizardInput';
import { getBtnPrimary, getBtnSuccess, wizardStyles } from './wizardStyles';
import { isAwsAccountId } from '@aws-access-bridge/shared';

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
        <WizardInput
          type="text"
          placeholder={t('admin.accountIdPlaceholder', 'AWS Account ID (12 digits)')}
          value={wizard.awsAccountId}
          onChange={(e) => wizard.setAwsAccountId(e.target.value)}
          pattern="[0-9]{12}"
        />
        <WizardInput
          type="text"
          placeholder={t('onboarding.nicknamePlaceholder', 'Nickname (optional)')}
          value={wizard.nickname}
          onChange={(e) => wizard.setNickname(e.target.value)}
        />
        {wizard.accountSaved && (
          <p className="text-sm" style={{ color: '#4ade80' }}>
            {t('onboarding.accountConfigured', 'Account configured.')}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button
            onClick={wizard.handleSaveAccount}
            disabled={wizard.isSavingAccount || !isAwsAccountId(wizard.awsAccountId)}
            className="font-medium"
            style={getBtnPrimary(wizardStyles, wizard.isSavingAccount || !isAwsAccountId(wizard.awsAccountId))}
          >
            {wizard.isSavingAccount ? t('onboarding.saving', 'Saving...') : t('onboarding.saveAccount', 'Save Account')}
          </button>
          <button
            onClick={wizard.goNext}
            disabled={!wizard.canAdvance}
            className="font-medium"
            style={getBtnSuccess(wizardStyles, !wizard.canAdvance)}
          >
            {t('onboarding.next', 'Next')}
          </button>
        </div>
      </div>
    </div>
  );
}
