'use client';

import type { ShowMessage } from '../hooks/useToast';
import { useOnboardingWizard } from '../hooks/useOnboardingWizard';
import { WIZARD_STEP } from '../lib/onboardingWizard';
import WizardProgress from './onboarding/WizardProgress';
import AccountStep from './onboarding/AccountStep';
import CredentialsStep from './onboarding/CredentialsStep';
import ChainStep from './onboarding/ChainStep';
import RolesStep from './onboarding/RolesStep';
import UsersStep from './onboarding/UsersStep';
import SummaryStep from './onboarding/SummaryStep';

interface OnboardingWizardProps {
  showMessage: ShowMessage;
}

/**
 * Onboarding wizard shell. Previously an 858-line god file (6 steps +
 * inline styles + all `apiCall`s + validation in one closure). State and
 * handlers live in `hooks/useOnboardingWizard`; each step is its own
 * component under `components/onboarding/`.
 */
export default function OnboardingWizard({ showMessage }: OnboardingWizardProps) {
  const wizard = useOnboardingWizard(showMessage);

  return (
    <div style={{ maxWidth: '56rem', margin: '0 auto' }}>
      <WizardProgress step={wizard.step} />
      {wizard.step === WIZARD_STEP.ACCOUNT && <AccountStep wizard={wizard} />}
      {wizard.step === WIZARD_STEP.CREDENTIALS && <CredentialsStep wizard={wizard} />}
      {wizard.step === WIZARD_STEP.CHAIN && <ChainStep wizard={wizard} />}
      {wizard.step === WIZARD_STEP.ROLES && <RolesStep wizard={wizard} />}
      {wizard.step === WIZARD_STEP.USERS && <UsersStep wizard={wizard} />}
      {wizard.step === WIZARD_STEP.SUMMARY && <SummaryStep wizard={wizard} />}
    </div>
  );
}
