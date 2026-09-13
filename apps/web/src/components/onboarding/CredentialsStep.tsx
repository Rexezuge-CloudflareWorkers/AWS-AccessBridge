'use client';

import { useTranslation } from 'react-i18next';
import type { OnboardingWizard } from '../../hooks/useOnboardingWizard';
import { getBtnPrimary, getBtnSuccess, getInputStyle, wizardStyles } from './wizardStyles';

/**
 * Step 2: IAM credentials (extracted from `OnboardingWizard.tsx` god file).
 */
export default function CredentialsStep({ wizard }: { wizard: OnboardingWizard }) {
  const { t } = useTranslation();
  return (
    <div style={wizardStyles.card}>
      <div style={wizardStyles.cardInner}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'white' }}>
          {t('onboarding.storeCredentials', 'Store Credentials')}
        </h3>
        <p className="text-sm" style={{ color: '#9ca3af' }}>
          {t('onboarding.credentialsStepHint', 'Enter IAM credentials. Validate first to confirm they work, then store them securely.')}
        </p>
        <input
          type="text"
          placeholder={t('admin.principalArnExample', 'Principal ARN (e.g., arn:aws:iam::123456789012:user/username)')}
          value={wizard.principalArn}
          onChange={(e) => wizard.setPrincipalArn(e.target.value)}
          style={getInputStyle(wizard.focusedInput, wizardStyles, 'principalArn')}
          onFocus={() => wizard.setFocusedInput('principalArn')}
          onBlur={() => wizard.setFocusedInput(null)}
        />
        <input
          type="text"
          placeholder={t('admin.accessKeyPlaceholder', 'Access Key ID')}
          value={wizard.accessKeyId}
          onChange={(e) => wizard.setAccessKeyId(e.target.value)}
          style={getInputStyle(wizard.focusedInput, wizardStyles, 'accessKeyId')}
          onFocus={() => wizard.setFocusedInput('accessKeyId')}
          onBlur={() => wizard.setFocusedInput(null)}
        />
        <input
          type="password"
          placeholder={t('admin.secretKeyPlaceholder', 'Secret Access Key')}
          value={wizard.secretAccessKey}
          onChange={(e) => wizard.setSecretAccessKey(e.target.value)}
          style={getInputStyle(wizard.focusedInput, wizardStyles, 'secretAccessKey')}
          onFocus={() => wizard.setFocusedInput('secretAccessKey')}
          onBlur={() => wizard.setFocusedInput(null)}
        />
        <input
          type="password"
          placeholder={t('onboarding.sessionTokenPlaceholder', 'Session Token (optional)')}
          value={wizard.sessionToken}
          onChange={(e) => wizard.setSessionToken(e.target.value)}
          style={getInputStyle(wizard.focusedInput, wizardStyles, 'sessionToken')}
          onFocus={() => wizard.setFocusedInput('sessionToken')}
          onBlur={() => wizard.setFocusedInput(null)}
        />
        {wizard.validationResult && (
          <p className="text-sm" style={{ color: '#4ade80' }}>
            {t('onboarding.identityIs', 'Identity: {{arn}} (Account: {{account}})', {
              arn: wizard.validationResult.arn,
              account: wizard.validationResult.accountId,
            })}
          </p>
        )}
        {wizard.credentialStored && (
          <p className="text-sm" style={{ color: '#4ade80' }}>
            {t('onboarding.credentialsStored', 'Credentials stored securely.')}
          </p>
        )}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            onClick={wizard.handleValidateCredentials}
            disabled={wizard.isValidating || !wizard.accessKeyId || !wizard.secretAccessKey}
            className="font-medium"
            style={getBtnPrimary(wizardStyles, wizard.isValidating || !wizard.accessKeyId || !wizard.secretAccessKey)}
          >
            {wizard.isValidating ? t('onboarding.validating', 'Validating...') : t('onboarding.validate', 'Validate')}
          </button>
          <button
            onClick={wizard.handleStoreCredentials}
            disabled={wizard.isStoring || !wizard.credentialValidated || !wizard.principalArn || !wizard.accessKeyId || !wizard.secretAccessKey}
            className="font-medium"
            style={getBtnSuccess(
              wizardStyles,
              wizard.isStoring || !wizard.credentialValidated || !wizard.principalArn || !wizard.accessKeyId || !wizard.secretAccessKey,
            )}
          >
            {wizard.isStoring ? t('onboarding.storing', 'Storing...') : t('onboarding.storeCredentials', 'Store Credentials')}
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '16px' }}>
          <button
            onClick={() => wizard.setStep(0)}
            className="font-medium"
            style={wizardStyles.btnSecondary}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#4b5563')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#374151')}
          >
            {t('onboarding.back', 'Back')}
          </button>
          <button
            onClick={() => wizard.setStep(2)}
            disabled={!wizard.credentialStored}
            className="font-medium"
            style={getBtnSuccess(wizardStyles, !wizard.credentialStored)}
          >
            {t('onboarding.next', 'Next')}
          </button>
        </div>
      </div>
    </div>
  );
}
