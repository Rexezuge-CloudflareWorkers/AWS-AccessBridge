'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../lib/api';
import LoadingButton from '../ui/LoadingButton';
import FocusInput from '../ui/FocusInput';
import { cardStyle, inputStyle } from '../ui/theme';

type ShowMessage = (type: 'success' | 'error', text: string) => void;

export default function DataCollectionTab({ showMessage }: { showMessage: ShowMessage }) {
  const { t } = useTranslation();
  const [enableForm, setEnableForm] = useState({
    principalArn: '',
    costEnabled: true,
    resourceEnabled: true,
  });
  const [disableForm, setDisableForm] = useState({
    principalArn: '',
    collectionType: 'cost',
  });

  const isEnableValid = enableForm.principalArn.trim() !== '' && (enableForm.costEnabled || enableForm.resourceEnabled);
  const isDisableValid = disableForm.principalArn.trim() !== '';

  const handleEnableCollection = async () => {
    if (!isEnableValid) return;

    const collectionTypes: string[] = [];
    if (enableForm.costEnabled) collectionTypes.push('cost');
    if (enableForm.resourceEnabled) collectionTypes.push('resource');

    const result = await apiFetch('/user/admin/collection/config', {
      method: 'POST',
      body: {
        principalArn: enableForm.principalArn,
        collectionTypes,
      },
    });

    if (result.ok) {
      showMessage(
        'success',
        t('admin.collectionEnabledFor', 'Data collection enabled for {{types}}', { types: collectionTypes.join(', ') }),
      );
      setEnableForm({ principalArn: '', costEnabled: true, resourceEnabled: true });
    } else {
      showMessage('error', result.error || t('admin.collectionEnableFailed', 'Failed to enable data collection'));
    }
  };

  const handleDisableCollection = async () => {
    if (!isDisableValid) return;

    const result = await apiFetch('/user/admin/collection/config', {
      method: 'DELETE',
      body: {
        principalArn: disableForm.principalArn,
        collectionType: disableForm.collectionType,
      },
    });

    if (result.ok) {
      showMessage(
        'success',
        t('admin.collectionDisabledFor', 'Data collection disabled for {{type}}', { type: disableForm.collectionType }),
      );
      setDisableForm({ principalArn: '', collectionType: 'cost' });
    } else {
      showMessage('error', result.error || t('admin.collectionDisableFailed', 'Failed to disable data collection'));
    }
  };

  const checkboxStyle: React.CSSProperties = {
    width: '18px',
    height: '18px',
    accentColor: '#2563eb',
    cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={cardStyle}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>
          {t('admin.enableDataCollection', 'Enable Data Collection')}
        </h3>
        <p style={{ color: '#d1d5db', marginBottom: '24px' }}>
          {t(
            'admin.collectionHint',
            'Enable background cost and/or resource inventory collection for a credential. The credential must have appropriate IAM permissions (ce:GetCostAndUsage for cost, ec2/s3/lambda/rds describe/list for resources).',
          )}
        </p>
        <form style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} onSubmit={(e) => e.preventDefault()}>
          <FocusInput
            type="text"
            placeholder={t('admin.principalArnRoleExample', 'Principal ARN (e.g., arn:aws:iam::123456789012:role/MonitoringRole)')}
            value={enableForm.principalArn}
            onChange={(e) => setEnableForm({ ...enableForm, principalArn: e.target.value })}
            required
          />
          <div style={{ display: 'flex', gap: '24px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#d1d5db', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={enableForm.costEnabled}
                onChange={(e) => setEnableForm({ ...enableForm, costEnabled: e.target.checked })}
                style={checkboxStyle}
              />
              {t('admin.costCollectionLabel', 'Cost data collection')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#d1d5db', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={enableForm.resourceEnabled}
                onChange={(e) => setEnableForm({ ...enableForm, resourceEnabled: e.target.checked })}
                style={checkboxStyle}
              />
              {t('admin.resourceCollectionLabel', 'Resource inventory collection')}
            </label>
          </div>
          <LoadingButton onClick={handleEnableCollection} disabled={!isEnableValid} variant="green">
            {t('admin.enableCollection', 'Enable Collection')}
          </LoadingButton>
        </form>
      </div>

      <div style={cardStyle}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>
          {t('admin.disableDataCollection', 'Disable Data Collection')}
        </h3>
        <form style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} onSubmit={(e) => e.preventDefault()}>
          <FocusInput
            type="text"
            placeholder={t('admin.principalArnPlaceholder', 'Principal ARN')}
            value={disableForm.principalArn}
            onChange={(e) => setDisableForm({ ...disableForm, principalArn: e.target.value })}
            required
          />
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: '#9ca3af', marginBottom: '6px', fontWeight: 500 }}>
              {t('admin.collectionTypeLabel', 'Collection Type')}
            </label>
            <select
              value={disableForm.collectionType}
              onChange={(e) => setDisableForm({ ...disableForm, collectionType: e.target.value })}
              style={{
                ...inputStyle,
                cursor: 'pointer',
              }}
            >
              <option value="cost">{t('admin.costOption', 'Cost')}</option>
              <option value="resource">{t('admin.resourceOption', 'Resource')}</option>
            </select>
          </div>
          <LoadingButton onClick={handleDisableCollection} disabled={!isDisableValid} variant="red">
            {t('admin.disableCollection', 'Disable Collection')}
          </LoadingButton>
        </form>
      </div>
    </div>
  );
}
