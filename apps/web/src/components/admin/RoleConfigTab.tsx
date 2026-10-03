'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deleteRoleConfig, setRoleConfig } from '../../services/adminService';
import LoadingButton from '../ui/LoadingButton';
import FocusInput from '../ui/FocusInput';
import { cardStyle } from '../ui/theme';
import type { ShowMessage } from '../../hooks/useToast';

export default function RoleConfigTab({ showMessage }: { showMessage: ShowMessage }) {
  const { t } = useTranslation();
  const [configForm, setConfigForm] = useState({
    awsAccountId: '',
    roleName: '',
    destinationPath: '',
    destinationRegion: '',
    roleSessionDurationSeconds: '',
  });

  const isSetConfigValid = configForm.awsAccountId.trim() !== '' && configForm.roleName.trim() !== '';
  const isDeleteConfigValid = configForm.awsAccountId.trim() !== '' && configForm.roleName.trim() !== '';

  const handleSetConfig = async () => {
    if (!isSetConfigValid) return;

    try {
      // Blank optional fields are omitted rather than sent empty: the route
      // distinguishes "not supplied" from "set to empty", so forwarding `''`
      // would blank a destination the admin meant to leave alone.
      await setRoleConfig(configForm.awsAccountId, configForm.roleName, {
        ...(configForm.destinationPath && { destinationPath: configForm.destinationPath }),
        ...(configForm.destinationRegion && { destinationRegion: configForm.destinationRegion }),
        ...(configForm.roleSessionDurationSeconds && {
          roleSessionDurationSeconds: Number(configForm.roleSessionDurationSeconds),
        }),
      });
      showMessage('success', t('admin.roleConfigSet', 'Role configuration set successfully'));
      setConfigForm({ awsAccountId: '', roleName: '', destinationPath: '', destinationRegion: '', roleSessionDurationSeconds: '' });
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : t('admin.roleConfigSetFailed', 'Failed to set role configuration'));
    }
  };

  const handleDeleteConfig = async () => {
    if (!isDeleteConfigValid) return;

    try {
      await deleteRoleConfig(configForm.awsAccountId, configForm.roleName);
      showMessage('success', t('admin.roleConfigDeleted', 'Role configuration deleted successfully'));
      setConfigForm({ awsAccountId: '', roleName: '', destinationPath: '', destinationRegion: '', roleSessionDurationSeconds: '' });
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : t('admin.roleConfigDeleteFailed', 'Failed to delete role configuration'));
    }
  };

  return (
    <div style={cardStyle}>
      <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>
        {t('admin.manageRoleConfig', 'Manage Role Configurations')}
      </h3>
      <p style={{ color: '#d1d5db', marginBottom: '24px' }}>
        {t(
          'admin.roleConfigHint',
          'Configure custom destination paths, regions, and session durations for AWS Console access when users assume specific roles.',
        )}
      </p>
      <form style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} onSubmit={(e) => e.preventDefault()}>
        <FocusInput
          type="text"
          placeholder={t('admin.accountIdPlaceholder', 'AWS Account ID (12 digits)')}
          value={configForm.awsAccountId}
          onChange={(e) => setConfigForm({ ...configForm, awsAccountId: e.target.value })}
          pattern="[0-9]{12}"
          required
        />
        <FocusInput
          type="text"
          placeholder={t('admin.roleNamePlaceholder', 'Role Name')}
          value={configForm.roleName}
          onChange={(e) => setConfigForm({ ...configForm, roleName: e.target.value })}
          required
        />
        <FocusInput
          type="text"
          placeholder={t('admin.destinationPathPlaceholder', 'Destination Path (Optional, e.g., /ec2/home)')}
          value={configForm.destinationPath}
          onChange={(e) => setConfigForm({ ...configForm, destinationPath: e.target.value })}
        />
        <FocusInput
          type="text"
          placeholder={t('admin.destinationRegionPlaceholder', 'Destination Region (Optional, e.g., us-east-1)')}
          value={configForm.destinationRegion}
          onChange={(e) => setConfigForm({ ...configForm, destinationRegion: e.target.value })}
        />
        <FocusInput
          type="number"
          placeholder={t('admin.sessionDurationPlaceholder', 'Role Session Duration Seconds (Optional, 900-43200)')}
          value={configForm.roleSessionDurationSeconds}
          onChange={(e) => setConfigForm({ ...configForm, roleSessionDurationSeconds: e.target.value })}
          min="900"
          max="43200"
          step="1"
        />
        <div style={{ display: 'flex', gap: '16px' }}>
          <LoadingButton onClick={handleSetConfig} disabled={!isSetConfigValid} variant="blue">
            {t('admin.setConfiguration', 'Set Configuration')}
          </LoadingButton>
          <LoadingButton onClick={handleDeleteConfig} disabled={!isDeleteConfigValid} variant="red">
            {t('admin.deleteConfiguration', 'Delete Configuration')}
          </LoadingButton>
        </div>
      </form>
    </div>
  );
}
