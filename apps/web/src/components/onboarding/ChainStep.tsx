'use client';

import { useTranslation } from 'react-i18next';
import type { OnboardingWizard } from '../../hooks/useOnboardingWizard';
import { getBtnPrimary, getInputStyle, wizardStyles } from './wizardStyles';

/**
 * Step 3: credential chain (extracted from `OnboardingWizard.tsx` god file).
 */
export default function ChainStep({ wizard }: { wizard: OnboardingWizard }) {
  const { t } = useTranslation();
  return (
    <div style={wizardStyles.card}>
      <div style={wizardStyles.cardInner}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'white' }}>
          {t('onboarding.chainTitle', 'Credential Chain (Optional)')}
        </h3>
        <p className="text-sm" style={{ color: '#9ca3af' }}>
          {t(
            'onboarding.chainHintFull',
            'Enter the intermediate role ARN that the credentials from Step 2 will assume. Leave empty if no chain is needed.',
          )}
        </p>
        <input
          type="text"
          placeholder={t('onboarding.intermediatePlaceholder', 'Intermediate Role ARN (role that credentials from Step 2 will assume)')}
          value={wizard.intermediateRoleArn}
          onChange={(e) => wizard.setIntermediateRoleArn(e.target.value)}
          style={getInputStyle(wizard.focusedInput, wizardStyles, 'intermediateRoleArn')}
          onFocus={() => wizard.setFocusedInput('intermediateRoleArn')}
          onBlur={() => wizard.setFocusedInput(null)}
        />
        {wizard.chainConfigured && (
          <p className="text-sm" style={{ color: '#4ade80' }}>
            {t('onboarding.usingForDiscovery', 'Chain configured. Using {{role}} for role discovery.', { role: wizard.roleForDiscovery })}
          </p>
        )}
        {wizard.chainTestResult && (
          <div className="text-sm" style={wizardStyles.chainResult}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {wizard.chainTestResult.map((r, i) => (
                <div key={i} style={{ color: r.status.startsWith('ok') ? '#4ade80' : '#f87171' }}>
                  {r.arn}: {r.status}
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            onClick={wizard.handleSetChain}
            disabled={wizard.isSettingChain || !wizard.intermediateRoleArn.trim()}
            className="font-medium"
            style={getBtnPrimary(wizardStyles, wizard.isSettingChain || !wizard.intermediateRoleArn.trim())}
          >
            {wizard.isSettingChain ? t('onboarding.setting', 'Setting...') : t('onboarding.setChain', 'Set Chain')}
          </button>
          <button
            onClick={wizard.handleTestChain}
            disabled={wizard.isTestingChain || !wizard.chainConfigured}
            className="font-medium"
            style={getBtnPrimary(wizardStyles, wizard.isTestingChain || !wizard.chainConfigured)}
          >
            {wizard.isTestingChain ? t('onboarding.testing', 'Testing...') : t('onboarding.testChain', 'Test Chain')}
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '16px' }}>
          <button
            onClick={() => wizard.setStep(1)}
            className="font-medium"
            style={wizardStyles.btnSecondary}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#4b5563')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#374151')}
          >
            {t('onboarding.back', 'Back')}
          </button>
          <button onClick={() => wizard.setStep(3)} className="font-medium" style={wizardStyles.btnSuccess}>
            {t('onboarding.next', 'Next')}
          </button>
        </div>
      </div>
    </div>
  );
}
