'use client';

import { useTranslation } from 'react-i18next';
import { WIZARD_STEP } from '../../lib/onboardingWizard';
import type { OnboardingWizard } from '../../hooks/useOnboardingWizard';
import RoleOption from './RoleOption';
import WizardInput from './WizardInput';
import { getBtnPrimary, getBtnSuccess, wizardStyles } from './wizardStyles';

/**
 * Step 4: role discovery & selection (extracted from `OnboardingWizard.tsx`).
 */
export default function RolesStep({ wizard }: { wizard: OnboardingWizard }) {
  const { t } = useTranslation();
  return (
    <div style={wizardStyles.card}>
      <div style={wizardStyles.cardInner}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'white' }}>{t('onboarding.discoverTitle', 'Discover & Select Roles')}</h3>
        <p className="text-sm" style={{ color: '#9ca3af' }}>
          {t('onboarding.discoverHint', 'Discover IAM roles in the account or add them manually.')}
        </p>
        <button
          onClick={wizard.handleDiscoverRoles}
          disabled={wizard.isDiscovering}
          className="font-medium"
          style={getBtnPrimary(wizardStyles, wizard.isDiscovering)}
        >
          {wizard.isDiscovering ? t('onboarding.discovering', 'Discovering...') : t('onboarding.discoverRoles', 'Discover Roles')}
        </button>
        {wizard.discoveredRoles.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '256px', overflowY: 'auto' }}>
            {wizard.discoveredRoles.map((role) => (
              <RoleOption key={role.roleName} role={role} selected={wizard.selectedRoles.has(role.roleName)} onToggle={wizard.toggleRole} />
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px' }}>
          <WizardInput
            type="text"
            placeholder={t('onboarding.manualRolePlaceholder', 'Manually add role name')}
            value={wizard.manualRoleName}
            onChange={(e) => wizard.setManualRoleName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') wizard.handleAddManualRole();
            }}
          />
          <button
            onClick={wizard.handleAddManualRole}
            disabled={!wizard.manualRoleName.trim()}
            className="font-medium"
            style={getBtnPrimary(wizardStyles, !wizard.manualRoleName.trim())}
          >
            {t('onboarding.add', 'Add')}
          </button>
        </div>
        <p className="text-sm" style={{ color: '#9ca3af' }}>
          {t('onboarding.rolesSelected', '{{count}} role(s) selected', { count: wizard.selectedRoles.size })}
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '16px' }}>
          <button
            onClick={() => wizard.setStep(WIZARD_STEP.CHAIN)}
            className="font-medium"
            style={wizardStyles.btnSecondary}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#4b5563')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#374151')}
          >
            {t('onboarding.back', 'Back')}
          </button>
          <button
            onClick={wizard.handleRolesNext}
            disabled={!wizard.canAdvance || wizard.isSavingRoles}
            className="font-medium"
            style={getBtnSuccess(wizardStyles, !wizard.canAdvance || wizard.isSavingRoles)}
          >
            {t('onboarding.next', 'Next')}
          </button>
        </div>
      </div>
    </div>
  );
}
