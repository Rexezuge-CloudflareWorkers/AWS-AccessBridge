'use client';

import { useState } from 'react';
import { WIZARD_STEP, canAdvanceFromStep, nextStep, previousStep } from '../lib/onboardingWizard';
import type { WizardStep } from '../lib/onboardingWizard';
import { useAccountStep } from './onboarding/useAccountStep';
import { useChainStep } from './onboarding/useChainStep';
import { useCredentialsStep } from './onboarding/useCredentialsStep';
import { useRolesStep } from './onboarding/useRolesStep';
import { useUsersStep } from './onboarding/useUsersStep';
import { useAsyncAction } from './useAsyncAction';
import type { ShowMessage } from './useToast';

/**
 * The onboarding wizard: a thin composition of one hook per step.
 *
 * Previously a single 317-line hook holding 25 state slices for six steps. The
 * cross-step rules that were the reason it stayed whole now live as pure,
 * tested functions in `lib/onboardingWizard` (credential edit → validation reset,
 * intermediate-ARN edit → chain reset, step gating); what is left here is wiring:
 * the shared `useAsyncAction`, the current step, and the few values one step
 * reads from another (the principal ARN feeds the chain, the resolved
 * assumed-by ARN feeds role discovery, the selection and account feed the grant).
 *
 * The result is flat — `wizard.awsAccountId`, not `wizard.account.awsAccountId` —
 * because the six step components take the whole wizard and a nested shape would
 * only add a hop.
 */
function useOnboardingWizard(showMessage: ShowMessage) {
  const [step, setStep] = useState<WizardStep>(WIZARD_STEP.ACCOUNT);
  const actions = useAsyncAction(showMessage);
  const deps = { showMessage, actions };

  const account = useAccountStep(deps);
  const credentials = useCredentialsStep(deps);
  const chain = useChainStep(deps, credentials.principalArn);
  const roles = useRolesStep(deps, chain.assumedByArn);
  const users = useUsersStep(deps, roles.selectedRoles, account.awsAccountId);

  const canAdvance = canAdvanceFromStep(step, {
    accountSaved: account.accountSaved,
    credentialStored: credentials.credentialStored,
    selectedRoleCount: roles.selectedRoles.size,
  });

  /**
   * Leaving the roles step saves the selection's relationships first, and stays
   * put if any of them failed.
   */
  const handleRolesNext = async (): Promise<void> => {
    if (await roles.handleSaveRoleRelationships()) {
      setStep(WIZARD_STEP.USERS);
    }
  };

  return {
    step,
    setStep,
    canAdvance,
    // Gated here as well as on the button, so the rule holds for any caller.
    goNext: () => {
      if (canAdvance) setStep(nextStep(step));
    },
    goBack: () => setStep(previousStep(step)),
    ...account,
    ...credentials,
    ...chain,
    ...roles,
    ...users,
    handleRolesNext,
  };
}

type OnboardingWizard = ReturnType<typeof useOnboardingWizard>;

export { useOnboardingWizard };
export type { OnboardingWizard };
