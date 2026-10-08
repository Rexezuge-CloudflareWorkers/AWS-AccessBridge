'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AWS_ACCOUNT_ID_ERROR_MESSAGE, isAwsAccountId } from '@aws-access-bridge/shared';
import { WIZARD_BUSY } from '../../lib/onboardingWizard';
import { setAccountNickname } from '../../services/adminService';
import type { StepDeps } from './types';

/**
 * Step 1 of the onboarding wizard: the AWS account id and optional nickname.
 */
function useAccountStep({ showMessage, actions }: StepDeps) {
  const { t } = useTranslation();
  const [awsAccountId, setAwsAccountId] = useState('');
  const [nickname, setNickname] = useState('');
  const [accountSaved, setAccountSaved] = useState(false);

  const handleSaveAccount = async (): Promise<void> => {
    if (!isAwsAccountId(awsAccountId)) {
      showMessage('error', AWS_ACCOUNT_ID_ERROR_MESSAGE);
      return;
    }
    const trimmedNickname = nickname.trim();
    await actions.run(
      WIZARD_BUSY.SAVE_ACCOUNT,
      async () => {
        // A blank nickname is "none": the account itself needs no write.
        if (trimmedNickname) {
          await setAccountNickname(awsAccountId, trimmedNickname);
        }
      },
      {
        errorFallback: t('onboarding.saveAccountFailed', 'Failed to save account'),
        onSuccess: () => setAccountSaved(true),
        successMessage: t('onboarding.accountConfigured', 'Account configured.'),
      },
    );
  };

  return {
    awsAccountId,
    setAwsAccountId,
    nickname,
    setNickname,
    accountSaved,
    isSavingAccount: actions.isBusy(WIZARD_BUSY.SAVE_ACCOUNT),
    handleSaveAccount,
  };
}

export { useAccountStep };
