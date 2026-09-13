'use client';

import { useTranslation } from 'react-i18next';
import type { OnboardingWizard } from '../../hooks/useOnboardingWizard';
import { getBtnPrimary, getBtnSuccess, getInputStyle, wizardStyles } from './wizardStyles';

/**
 * Step 4: role discovery & selection (extracted from `OnboardingWizard.tsx`).
 */
export default function RolesStep({ wizard }: { wizard: OnboardingWizard }) {
  const { t } = useTranslation();
  return (
    <div style={wizardStyles.card}>
      <div style={wizardStyles.cardInner}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'white' }}>
          {t('onboarding.discoverTitle', 'Discover & Select Roles')}
        </h3>
        <p className="text-sm" style={{ color: '#9ca3af' }}>
          {t('onboarding.discoverHint', 'Discover IAM roles in the account or add them manually.')}
        </p>
        <button onClick={wizard.handleDiscoverRoles} disabled={wizard.isLoading} className="font-medium" style={getBtnPrimary(wizardStyles, wizard.isLoading)}>
          {wizard.isLoading ? t('onboarding.discovering', 'Discovering...') : t('onboarding.discoverRoles', 'Discover Roles')}
        </button>
        {wizard.discoveredRoles.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '256px', overflowY: 'auto' }}>
            {wizard.discoveredRoles.map((role) => (
              <label
                key={role.roleName}
                className="cursor-pointer"
                style={{
                  ...wizardStyles.roleLabel,
                  background: wizard.hoveredRole === role.roleName ? '#313b50' : '#252d3d',
                }}
                onMouseEnter={() => wizard.setHoveredRole(role.roleName)}
                onMouseLeave={() => wizard.setHoveredRole(null)}
              >
                <input type="checkbox" checked={wizard.selectedRoles.has(role.roleName)} onChange={() => wizard.toggleRole(role.roleName)} />
                <span className="font-medium">{role.roleName}</span>
                {role.description && (
                  <span className="text-sm" style={{ color: '#9ca3af' }}>
                    — {role.description}
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder={t('onboarding.manualRolePlaceholder', 'Manually add role name')}
            value={wizard.manualRoleName}
            onChange={(e) => wizard.setManualRoleName(e.target.value)}
            style={getInputStyle(wizard.focusedInput, wizardStyles, 'manualRole')}
            onFocus={() => wizard.setFocusedInput('manualRole')}
            onBlur={() => wizard.setFocusedInput(null)}
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
            onClick={() => wizard.setStep(2)}
            className="font-medium"
            style={wizardStyles.btnSecondary}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#4b5563')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#374151')}
          >
            {t('onboarding.back', 'Back')}
          </button>
          <button
            onClick={wizard.handleStep4Next}
            disabled={wizard.selectedRoles.size === 0 || wizard.isLoading}
            className="font-medium"
            style={getBtnSuccess(wizardStyles, wizard.selectedRoles.size === 0 || wizard.isLoading)}
          >
            {t('onboarding.next', 'Next')}
          </button>
        </div>
      </div>
    </div>
  );
}
