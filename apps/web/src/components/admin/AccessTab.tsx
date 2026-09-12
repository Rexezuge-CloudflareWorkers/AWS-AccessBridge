'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../lib/api';
import LoadingButton from '../ui/LoadingButton';
import FocusInput from '../ui/FocusInput';
import { cardStyle } from '../ui/theme';

type ShowMessage = (type: 'success' | 'error', text: string) => void;

export default function AccessTab({ showMessage }: { showMessage: ShowMessage }) {
  const { t } = useTranslation();
  const [accessForm, setAccessForm] = useState({
    userEmail: '',
    awsAccountId: '',
    roleName: '',
  });

  const isFormValid = accessForm.awsAccountId.trim() !== '' && accessForm.roleName.trim() !== '';

  const handleGrantAccess = async () => {
    if (!isFormValid) return;

    const result = await apiFetch('/user/admin/access', {
      method: 'POST',
      body: {
        userEmail: accessForm.userEmail || undefined,
        awsAccountId: accessForm.awsAccountId,
        roleName: accessForm.roleName,
      },
    });

    if (result.ok) {
      showMessage('success', t('admin.accessGranted', 'Access granted successfully'));
      setAccessForm({ userEmail: '', awsAccountId: '', roleName: '' });
    } else {
      showMessage('error', result.error || t('admin.accessGrantFailed', 'Failed to grant access'));
    }
  };

  const handleRevokeAccess = async () => {
    if (!isFormValid) return;

    const result = await apiFetch('/user/admin/access', {
      method: 'DELETE',
      body: {
        userEmail: accessForm.userEmail || undefined,
        awsAccountId: accessForm.awsAccountId,
        roleName: accessForm.roleName,
      },
    });

    if (result.ok) {
      showMessage('success', t('admin.accessRevoked', 'Access revoked successfully'));
      setAccessForm({ userEmail: '', awsAccountId: '', roleName: '' });
    } else {
      showMessage('error', result.error || t('admin.accessRevokeFailed', 'Failed to revoke access'));
    }
  };

  return (
    <div style={cardStyle}>
      <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>{t('admin.manageAccess', 'Manage User Access')}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <FocusInput
          type="text"
          placeholder={t('admin.accountIdPlaceholder', 'AWS Account ID (12 digits)')}
          value={accessForm.awsAccountId}
          onChange={(e) => setAccessForm({ ...accessForm, awsAccountId: e.target.value })}
          pattern="[0-9]{12}"
        />
        <FocusInput
          type="text"
          placeholder={t('admin.roleNamePlaceholder', 'Role Name')}
          value={accessForm.roleName}
          onChange={(e) => setAccessForm({ ...accessForm, roleName: e.target.value })}
        />
        <FocusInput
          type="email"
          placeholder={t('admin.userEmailPlaceholder', 'User Email (Optional, defaults to current user)')}
          value={accessForm.userEmail}
          onChange={(e) => setAccessForm({ ...accessForm, userEmail: e.target.value })}
        />
        <div style={{ display: 'flex', gap: '16px' }}>
          <LoadingButton onClick={handleGrantAccess} disabled={!isFormValid} variant="green">
            {t('admin.grantAccess', 'Grant Access')}
          </LoadingButton>
          <LoadingButton onClick={handleRevokeAccess} disabled={!isFormValid} variant="red">
            {t('admin.revokeAccess', 'Revoke Access')}
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}
