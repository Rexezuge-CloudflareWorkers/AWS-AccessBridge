'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { grantSelectedRoles } from '../../lib/onboardingBatches';
import { WIZARD_BUSY, validEmails } from '../../lib/onboardingWizard';
import type { StepDeps } from './types';

/**
 * Step 5: grant the selected roles to a list of users.
 */
function useUsersStep({ showMessage, actions }: StepDeps, selectedRoles: ReadonlySet<string>, awsAccountId: string) {
  const { t } = useTranslation();
  const [userEmails, setUserEmails] = useState<string[]>(['']);
  const [accessGranted, setAccessGranted] = useState(false);

  const handleGrantAccess = async (): Promise<void> => {
    const emails = validEmails(userEmails);
    if (emails.length === 0 || selectedRoles.size === 0) {
      showMessage('error', t('onboarding.assignRequired', 'Add at least one user email and select at least one role.'));
      return;
    }
    await actions.run(
      WIZARD_BUSY.GRANT,
      async () => {
        const { failures } = await grantSelectedRoles(emails, new Set(selectedRoles), awsAccountId);
        // A partial failure is a failure: some users are still without access.
        if (failures > 0) {
          throw new Error(t('onboarding.accessGrantFailed', '{{count}} access grant(s) failed. Check logs for details.', { count: failures }));
        }
      },
      {
        errorFallback: t('onboarding.accessGrantFailed', '{{count}} access grant(s) failed. Check logs for details.', { count: 0 }),
        onSuccess: () => setAccessGranted(true),
        successMessage: t('onboarding.accessGrantedTo', 'Access granted to {{users}} user(s) for {{roles}} role(s).', {
          users: emails.length,
          roles: selectedRoles.size,
        }),
      },
    );
  };

  return {
    userEmails,
    setUserEmails,
    accessGranted,
    isGranting: actions.isBusy(WIZARD_BUSY.GRANT),
    handleGrantAccess,
  };
}

export { useUsersStep };
