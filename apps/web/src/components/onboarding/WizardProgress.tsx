'use client';

import { useTranslation } from 'react-i18next';

const STEPS = ['Account', 'Credentials', 'Chain', 'Roles', 'Users', 'Summary'] as const;

/**
 * Step indicator extracted from `OnboardingWizard.tsx`.
 */
export default function WizardProgress({ step }: { step: number }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2.5rem' }}>
      {STEPS.map((_, i) => (
        <div key={STEPS[i]} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? '1' : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              className="text-sm font-bold"
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: i < step ? '#16a34a' : i === step ? '#2563eb' : '#374151',
                color: i <= step ? 'white' : '#9ca3af',
                boxShadow: i === step ? '0 0 0 4px rgba(37, 99, 235, 0.2)' : 'none',
              }}
            >
              {i < step ? '✓' : i + 1}
            </div>
            <span
              className="text-sm font-medium"
              style={{ color: i === step ? 'white' : i < step ? '#4ade80' : '#6b7280' }}
            >
              {t(`onboarding.step${STEPS[i]}`, STEPS[i])}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ flex: 1, height: '2px', margin: '0 12px', background: i < step ? '#16a34a' : '#374151' }} />
          )}
        </div>
      ))}
    </div>
  );
}

export { STEPS };
