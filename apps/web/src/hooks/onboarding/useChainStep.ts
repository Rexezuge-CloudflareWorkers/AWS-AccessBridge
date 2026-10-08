'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EMPTY_CHAIN, WIZARD_BUSY, editIntermediateRoleArn, resolveAssumedByArn } from '../../lib/onboardingWizard';
import type { ChainState } from '../../lib/onboardingWizard';
import { storeCredentialRelationship, testCredentialChain } from '../../services/adminService';
import type { StepDeps } from './types';

/**
 * Step 3: the optional credential chain, and the test that walks it.
 *
 * `principalArn` comes from the credentials step: the chain is a relationship
 * *from* the intermediate role *to* that principal.
 */
function useChainStep({ showMessage, actions }: StepDeps, principalArn: string) {
  const { t } = useTranslation();
  const [chain, setChain] = useState<ChainState>(EMPTY_CHAIN);

  const handleSetChain = async (): Promise<void> => {
    const { intermediateRoleArn } = chain;
    if (!intermediateRoleArn.trim()) {
      showMessage('error', t('onboarding.intermediateRequired', 'Intermediate Role ARN is required.'));
      return;
    }
    await actions.run(WIZARD_BUSY.SET_CHAIN, () => storeCredentialRelationship(intermediateRoleArn, principalArn), {
      errorFallback: t('onboarding.chainConfigureFailed', 'Failed to configure chain'),
      onSuccess: () => setChain((previous) => ({ ...previous, chainConfigured: true, roleForDiscovery: intermediateRoleArn })),
      successMessage: t('onboarding.chainConfigured', 'Credential chain configured.'),
    });
  };

  const handleTestChain = async (): Promise<void> => {
    await actions.run(WIZARD_BUSY.TEST_CHAIN, () => testCredentialChain(resolveAssumedByArn(chain, principalArn)), {
      errorFallback: t('onboarding.chainTestError', 'Chain test failed'),
      onSuccess: (result) => {
        setChain((previous) => ({ ...previous, chainTestResult: result.chain }));
        if (result.success) {
          showMessage('success', t('onboarding.chainPassed', 'Chain test passed!'));
        } else {
          showMessage('error', t('onboarding.chainFailed', 'Chain test failed. Check results below.'));
        }
      },
    });
  };

  return {
    intermediateRoleArn: chain.intermediateRoleArn,
    setIntermediateRoleArn: (value: string) => setChain((previous) => editIntermediateRoleArn(previous, value)),
    chainConfigured: chain.chainConfigured,
    chainTestResult: chain.chainTestResult,
    roleForDiscovery: chain.roleForDiscovery,
    assumedByArn: resolveAssumedByArn(chain, principalArn),
    isSettingChain: actions.isBusy(WIZARD_BUSY.SET_CHAIN),
    isTestingChain: actions.isBusy(WIZARD_BUSY.TEST_CHAIN),
    handleSetChain,
    handleTestChain,
  };
}

export { useChainStep };
