'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { grantAccess, revokeAccess } from '../../services/adminService';
import LoadingButton from '../ui/LoadingButton';
import FocusInput from '../ui/FocusInput';
import { cardStyle } from '../ui/theme';
import type { ShowMessage } from '../../hooks/useToast';

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

    try {
      // `undefined` rather than `''`: the route falls back to the authenticated
      // admin only when the field is absent, so an empty string would be sent
      // as a real (invalid) address.
      await grantAccess(accessForm.userEmail || undefined, accessForm.awsAccountId, accessForm.roleName);
      showMessage('success', t('admin.accessGranted', 'Access granted successfully'));
      setAccessForm({ userEmail: '', awsAccountId: '', roleName: '' });
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : t('admin.accessGrantFailed', 'Failed to grant access'));
    }
  };

  const handleRevokeAccess = async () => {
    if (!isFormValid) return;

    try {
      await revokeAccess(accessForm.userEmail || undefined, accessForm.awsAccountId, accessForm.roleName);
      showMessage('success', t('admin.accessRevoked', 'Access revoked successfully'));
      setAccessForm({ userEmail: '', awsAccountId: '', roleName: '' });
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : t('admin.accessRevokeFailed', 'Failed to revoke access'));
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
