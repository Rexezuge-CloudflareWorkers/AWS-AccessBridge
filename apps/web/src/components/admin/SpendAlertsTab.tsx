'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createSpendAlert, deleteSpendAlert } from '../../services/adminService';
import LoadingButton from '../ui/LoadingButton';
import FocusInput from '../ui/FocusInput';
import { cardStyle, inputStyle } from '../ui/theme';
import type { ShowMessage } from '../../hooks/useToast';

export default function SpendAlertsTab({ showMessage }: { showMessage: ShowMessage }) {
  const { t } = useTranslation();
  const [createForm, setCreateForm] = useState({
    awsAccountId: '',
    thresholdAmount: '',
    periodType: 'monthly',
  });
  const [deleteAlertId, setDeleteAlertId] = useState('');

  const isCreateValid = createForm.awsAccountId.trim() !== '' && createForm.thresholdAmount.trim() !== '';
  const isDeleteValid = deleteAlertId.trim() !== '';

  const handleCreateAlert = async () => {
    if (!isCreateValid) return;

    try {
      const created = await createSpendAlert({
        awsAccountId: createForm.awsAccountId,
        thresholdAmount: Number(createForm.thresholdAmount),
        periodType: createForm.periodType,
      });
      showMessage('success', t('admin.alertCreatedWithId', 'Spend alert created (ID: {{id}})', { id: created.id || 'unknown' }));
      setCreateForm({ awsAccountId: '', thresholdAmount: '', periodType: 'monthly' });
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : t('admin.alertCreateFailed', 'Failed to create spend alert'));
    }
  };

  const handleDeleteAlert = async () => {
    if (!isDeleteValid) return;

    try {
      await deleteSpendAlert(deleteAlertId.trim());
      showMessage('success', t('admin.alertDeleted', 'Spend alert deleted'));
      setDeleteAlertId('');
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : t('admin.alertDeleteFailed', 'Failed to delete spend alert'));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={cardStyle}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>{t('admin.createSpendAlert', 'Create Spend Alert')}</h3>
        <p style={{ color: '#d1d5db', marginBottom: '24px' }}>
          {t(
            'admin.spendAlertsHint',
            'Set up cost threshold alerts for AWS accounts. Alerts are evaluated against cost data collected by background tasks.',
          )}
        </p>
        <form style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} onSubmit={(e) => e.preventDefault()}>
          <FocusInput
            type="text"
            placeholder={t('admin.accountIdPlaceholder', 'AWS Account ID (12 digits)')}
            value={createForm.awsAccountId}
            onChange={(e) => setCreateForm({ ...createForm, awsAccountId: e.target.value })}
            pattern="[0-9]{12}"
            required
          />
          <FocusInput
            type="number"
            placeholder={t('admin.thresholdPlaceholder', 'Threshold Amount (USD)')}
            value={createForm.thresholdAmount}
            onChange={(e) => setCreateForm({ ...createForm, thresholdAmount: e.target.value })}
            min="0"
            step="0.01"
            required
          />
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: '#9ca3af', marginBottom: '6px', fontWeight: 500 }}>
              {t('admin.periodTypeLabel', 'Period Type')}
            </label>
            <select
              value={createForm.periodType}
              onChange={(e) => setCreateForm({ ...createForm, periodType: e.target.value })}
              style={{
                ...inputStyle,
                cursor: 'pointer',
              }}
            >
              <option value="monthly">{t('admin.monthlyOption', 'Monthly')}</option>
              <option value="daily">{t('admin.dailyOption', 'Daily')}</option>
            </select>
          </div>
          <LoadingButton onClick={handleCreateAlert} disabled={!isCreateValid} variant="green">
            {t('admin.createAlertButton', 'Create Alert')}
          </LoadingButton>
        </form>
      </div>

      <div style={cardStyle}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>{t('admin.deleteSpendAlert', 'Delete Spend Alert')}</h3>
        <form style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} onSubmit={(e) => e.preventDefault()}>
          <FocusInput
            type="text"
            placeholder={t('admin.alertIdPlaceholder', 'Alert ID (UUID)')}
            value={deleteAlertId}
            onChange={(e) => setDeleteAlertId(e.target.value)}
            required
          />
          <LoadingButton onClick={handleDeleteAlert} disabled={!isDeleteValid} variant="red">
            {t('admin.deleteAlertButton', 'Delete Alert')}
          </LoadingButton>
        </form>
      </div>
    </div>
  );
}
