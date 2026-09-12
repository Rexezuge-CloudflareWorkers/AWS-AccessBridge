'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../lib/api';
import LoadingButton from '../ui/LoadingButton';
import FocusInput from '../ui/FocusInput';
import { cardStyle } from '../ui/theme';

type ShowMessage = (type: 'success' | 'error', text: string) => void;

export default function CredentialsTab({ showMessage }: { showMessage: ShowMessage }) {
  const { t } = useTranslation();
  const [credForm, setCredForm] = useState({
    principalArn: '',
    accessKeyId: '',
    secretAccessKey: '',
    sessionToken: '',
  });
  const [relationForm, setRelationForm] = useState({
    principalArn: '',
    assumedBy: '',
  });

  const isCredFormValid =
    credForm.principalArn.trim() !== '' && credForm.accessKeyId.trim() !== '' && credForm.secretAccessKey.trim() !== '';
  const isRelationFormValid = relationForm.principalArn.trim() !== '' && relationForm.assumedBy.trim() !== '';
  const isRemoveRelationFormValid = relationForm.principalArn.trim() !== '';

  const handleAddCredentials = async () => {
    if (!isCredFormValid) return;

    const result = await apiFetch('/user/admin/credentials', {
      method: 'POST',
      body: {
        principalArn: credForm.principalArn,
        accessKeyId: credForm.accessKeyId,
        secretAccessKey: credForm.secretAccessKey,
        ...(credForm.sessionToken && { sessionToken: credForm.sessionToken }),
      },
    });

    if (result.ok) {
      showMessage('success', t('admin.credentialsAdded', 'Credentials added successfully'));
      setCredForm({ principalArn: '', accessKeyId: '', secretAccessKey: '', sessionToken: '' });
    } else {
      showMessage('error', result.error || t('admin.credentialsAddFailed', 'Failed to add credentials'));
    }
  };

  const handleAddRelation = async () => {
    if (!isRelationFormValid) return;

    const result = await apiFetch('/user/admin/credentials/relationship', {
      method: 'POST',
      body: {
        principalArn: relationForm.principalArn,
        assumedBy: relationForm.assumedBy,
      },
    });

    if (result.ok) {
      showMessage('success', t('admin.relationshipAdded', 'Credential relationship added successfully'));
      setRelationForm({ principalArn: '', assumedBy: '' });
    } else {
      showMessage('error', result.error || t('admin.relationshipAddFailed', 'Failed to add relationship'));
    }
  };

  const handleRemoveRelation = async () => {
    if (!isRemoveRelationFormValid) return;

    const result = await apiFetch('/user/admin/credentials/relationship', {
      method: 'DELETE',
      body: {
        principalArn: relationForm.principalArn,
      },
    });

    if (result.ok) {
      showMessage('success', t('admin.relationshipRemoved', 'Credential relationship removed successfully'));
      setRelationForm({ principalArn: '', assumedBy: '' });
    } else {
      showMessage('error', result.error || t('admin.relationshipRemoveFailed', 'Failed to remove relationship'));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={cardStyle}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>{t('admin.addCredentials', 'Add AWS Credentials')}</h3>
        <form onSubmit={(e) => e.preventDefault()} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <FocusInput
            type="text"
            placeholder={t('admin.principalArnExample', 'Principal ARN (e.g., arn:aws:iam::123456789012:user/username)')}
            value={credForm.principalArn}
            onChange={(e) => setCredForm({ ...credForm, principalArn: e.target.value })}
            required
          />
          <FocusInput
            type="text"
            placeholder={t('admin.accessKeyPlaceholder', 'Access Key ID')}
            value={credForm.accessKeyId}
            onChange={(e) => setCredForm({ ...credForm, accessKeyId: e.target.value })}
            required
          />
          <FocusInput
            type="password"
            placeholder={t('admin.secretKeyPlaceholder', 'Secret Access Key')}
            value={credForm.secretAccessKey}
            onChange={(e) => setCredForm({ ...credForm, secretAccessKey: e.target.value })}
            required
          />
          <FocusInput
            type="password"
            placeholder={t('admin.sessionTokenPlaceholder', 'Session Token (Optional)')}
            value={credForm.sessionToken}
            onChange={(e) => setCredForm({ ...credForm, sessionToken: e.target.value })}
          />
          <LoadingButton type="submit" onClick={handleAddCredentials} disabled={!isCredFormValid} variant="blue">
            {t('admin.addCredentialsButton', 'Add Credentials')}
          </LoadingButton>
        </form>
      </div>

      <div style={cardStyle}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>
          {t('admin.manageRelationships', 'Manage Credential Relationships')}
        </h3>
        <form style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} onSubmit={(e) => e.preventDefault()}>
          <FocusInput
            type="text"
            placeholder={t('admin.principalArnPlaceholder', 'Principal ARN')}
            value={relationForm.principalArn}
            onChange={(e) => setRelationForm({ ...relationForm, principalArn: e.target.value })}
            required
          />
          <FocusInput
            type="text"
            placeholder={t('admin.assumedByPlaceholder', 'Assumed By ARN')}
            value={relationForm.assumedBy}
            onChange={(e) => setRelationForm({ ...relationForm, assumedBy: e.target.value })}
            required
          />
          <div style={{ display: 'flex', gap: '16px' }}>
            <LoadingButton onClick={handleAddRelation} disabled={!isRelationFormValid} variant="green">
              {t('admin.addRelationship', 'Add Relationship')}
            </LoadingButton>
            <LoadingButton onClick={handleRemoveRelation} disabled={!isRemoveRelationFormValid} variant="red">
              {t('admin.removeRelationship', 'Remove Relationship')}
            </LoadingButton>
          </div>
        </form>
      </div>
    </div>
  );
}
