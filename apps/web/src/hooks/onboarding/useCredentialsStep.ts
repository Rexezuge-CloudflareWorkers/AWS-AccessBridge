'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EMPTY_CREDENTIALS, WIZARD_BUSY, editCredentialField } from '../../lib/onboardingWizard';
import type { CredentialsState, ValidatedCredentialField } from '../../lib/onboardingWizard';
import { storeCredentials, validateCredentials } from '../../services/adminService';
import type { StepDeps } from './types';

/**
 * Step 2: IAM credentials. Validate first, then store.
 *
 * The invalidate-on-edit rule is `editCredentialField` in `lib/onboardingWizard`;
 * the setters here only route a field to it.
 */
function useCredentialsStep({ showMessage, actions }: StepDeps) {
  const { t } = useTranslation();
  const [credentials, setCredentials] = useState<CredentialsState>(EMPTY_CREDENTIALS);

  const setValidatedField = (field: ValidatedCredentialField) => (value: string) => {
    setCredentials((previous) => editCredentialField(previous, field, value));
  };

  const handleValidateCredentials = async (): Promise<void> => {
    const { accessKeyId, secretAccessKey, sessionToken } = credentials;
    await actions.run(
      WIZARD_BUSY.VALIDATE,
      () => validateCredentials(accessKeyId, secretAccessKey, sessionToken || undefined),
      {
        errorFallback: t('onboarding.validationFailed', 'Validation failed'),
        onSuccess: (result) => setCredentials((previous) => ({ ...previous, validationResult: result, credentialValidated: true })),
        onError: () => setCredentials((previous) => ({ ...previous, validationResult: null, credentialValidated: false })),
        successMessage: (result) => t('onboarding.credentialsValid', 'Credentials valid. Identity: {{identity}}', { identity: result.arn }),
      },
    );
  };

  const handleStoreCredentials = async (): Promise<void> => {
    const { principalArn, accessKeyId, secretAccessKey, sessionToken } = credentials;
    if (!principalArn.trim()) {
      showMessage('error', t('onboarding.principalRequired', 'Principal ARN is required.'));
      return;
    }
    await actions.run(WIZARD_BUSY.STORE, () => storeCredentials(principalArn, accessKeyId, secretAccessKey, sessionToken || undefined), {
      errorFallback: t('onboarding.storeCredentialsFailed', 'Failed to store credentials'),
      onSuccess: () => setCredentials((previous) => ({ ...previous, credentialStored: true })),
      successMessage: t('onboarding.credentialsStored', 'Credentials stored securely.'),
    });
  };

  return {
    principalArn: credentials.principalArn,
    setPrincipalArn: (value: string) => setCredentials((previous) => ({ ...previous, principalArn: value })),
    accessKeyId: credentials.accessKeyId,
    setAccessKeyId: setValidatedField('accessKeyId'),
    secretAccessKey: credentials.secretAccessKey,
    setSecretAccessKey: setValidatedField('secretAccessKey'),
    sessionToken: credentials.sessionToken,
    setSessionToken: setValidatedField('sessionToken'),
    credentialValidated: credentials.credentialValidated,
    credentialStored: credentials.credentialStored,
    validationResult: credentials.validationResult,
    isValidating: actions.isBusy(WIZARD_BUSY.VALIDATE),
    isStoring: actions.isBusy(WIZARD_BUSY.STORE),
    handleValidateCredentials,
    handleStoreCredentials,
  };
}

export { useCredentialsStep };
