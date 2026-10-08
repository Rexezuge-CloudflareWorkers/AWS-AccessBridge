'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { saveRoleRelationships } from '../../lib/onboardingBatches';
import { WIZARD_BUSY, addManualRole, toggleSelection } from '../../lib/onboardingWizard';
import type { DiscoveredRole } from '../../lib/onboardingWizard';
import { discoverAccountRoles } from '../../services/adminService';
import type { StepDeps } from './types';

/**
 * Step 4: discover the account's roles (or type them in) and pick which to use.
 *
 * `assumedByArn` is the ARN the discovery and relationship writes assume from —
 * see `resolveAssumedByArn`.
 */
function useRolesStep({ actions }: StepDeps, assumedByArn: string) {
  const { t } = useTranslation();
  const [discoveredRoles, setDiscoveredRoles] = useState<DiscoveredRole[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [manualRoleName, setManualRoleName] = useState('');

  const handleDiscoverRoles = async (): Promise<void> => {
    await actions.run(WIZARD_BUSY.DISCOVER, () => discoverAccountRoles(assumedByArn), {
      errorFallback: t('onboarding.discoveryFailed', 'Discovery failed'),
      onSuccess: (result) => setDiscoveredRoles(result.roles),
      successMessage: (result) => t('onboarding.rolesFound', 'Found {{count}} roles.', { count: result.roles.length }),
      // A failed discovery is not a dead end: roles can still be typed in.
      formatError: (message) => `${message} ${t('onboarding.manualHint', 'You can manually add role names below.')}`,
    });
  };

  const toggleRole = (roleName: string): void => {
    setSelectedRoles((previous) => toggleSelection(previous, roleName));
  };

  const handleAddManualRole = (): void => {
    const added = addManualRole(discoveredRoles, selectedRoles, manualRoleName, t('onboarding.manuallyAdded', '(manually added)'));
    if (!added) return;
    setDiscoveredRoles(added.discoveredRoles);
    setSelectedRoles(added.selectedRoles);
    setManualRoleName('');
  };

  /**
   * Persists a relationship per selected role. Resolves `true` when the wizard may
   * advance: nothing to save is success — an empty selection or an unknown ARN is
   * a state it must be able to move past — and a partial failure is not.
   */
  const handleSaveRoleRelationships = async (): Promise<boolean> => {
    if (!assumedByArn || selectedRoles.size === 0) return true;
    const result = await actions.run(
      WIZARD_BUSY.SAVE_ROLES,
      async () => {
        const saved = await saveRoleRelationships(selectedRoles, discoveredRoles, assumedByArn);
        if (!saved.ok) {
          throw new Error(
            t('onboarding.rolesSaveFailed', '{{count}} role relationship(s) failed to save.', { count: saved.failures }),
          );
        }
      },
      { errorFallback: t('onboarding.rolesSaveFailed', '{{count}} role relationship(s) failed to save.', { count: 0 }) },
    );
    return result.ok;
  };

  return {
    discoveredRoles,
    selectedRoles,
    manualRoleName,
    setManualRoleName,
    isDiscovering: actions.isBusy(WIZARD_BUSY.DISCOVER),
    isSavingRoles: actions.isBusy(WIZARD_BUSY.SAVE_ROLES),
    handleDiscoverRoles,
    toggleRole,
    handleAddManualRole,
    handleSaveRoleRelationships,
  };
}

export { useRolesStep };
