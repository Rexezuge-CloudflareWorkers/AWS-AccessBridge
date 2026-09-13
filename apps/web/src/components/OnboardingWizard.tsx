'use client';

import { useOnboardingWizard } from '../hooks/useOnboardingWizard';
import WizardProgress from './onboarding/WizardProgress';
import AccountStep from './onboarding/AccountStep';
import CredentialsStep from './onboarding/CredentialsStep';
import ChainStep from './onboarding/ChainStep';
import RolesStep from './onboarding/RolesStep';
import UsersStep from './onboarding/UsersStep';
import SummaryStep from './onboarding/SummaryStep';

interface OnboardingWizardProps {
  showMessage: (type: 'success' | 'error', text: string) => void;
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
      {wizard.step === 0 && <AccountStep wizard={wizard} />}
      {wizard.step === 1 && <CredentialsStep wizard={wizard} />}
      {wizard.step === 2 && <ChainStep wizard={wizard} />}
      {wizard.step === 3 && <RolesStep wizard={wizard} />}
      {wizard.step === 4 && <UsersStep wizard={wizard} />}
      {wizard.step === 5 && <SummaryStep wizard={wizard} />}
    </div>
  );
}
