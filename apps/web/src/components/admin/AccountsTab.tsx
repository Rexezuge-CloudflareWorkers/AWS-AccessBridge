'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../lib/api';
import LoadingButton from '../ui/LoadingButton';
import FocusInput from '../ui/FocusInput';
import { cardStyle } from '../ui/theme';

type ShowMessage = (type: 'success' | 'error', text: string) => void;

export default function AccountsTab({ showMessage }: { showMessage: ShowMessage }) {
  const { t } = useTranslation();
  const [nicknameForm, setNicknameForm] = useState({
    awsAccountId: '',
    nickname: '',
  });

  const isSetNicknameValid = nicknameForm.awsAccountId.trim() !== '' && nicknameForm.nickname.trim() !== '';
  const isRemoveNicknameValid = nicknameForm.awsAccountId.trim() !== '';

  const handleSetNickname = async () => {
    if (!isSetNicknameValid) return;

    const result = await apiFetch('/user/admin/account/nickname', {
      method: 'PUT',
      body: {
        awsAccountId: nicknameForm.awsAccountId,
        nickname: nicknameForm.nickname,
      },
    });

    if (result.ok) {
      showMessage('success', t('admin.nicknameSet', 'Account nickname set successfully'));
      setNicknameForm({ awsAccountId: '', nickname: '' });
    } else {
      showMessage('error', result.error || t('admin.nicknameSetFailed', 'Failed to set nickname'));
    }
  };

  const handleRemoveNickname = async () => {
    if (!isRemoveNicknameValid) return;

    const result = await apiFetch('/user/admin/account/nickname', {
      method: 'DELETE',
      body: {
        awsAccountId: nicknameForm.awsAccountId,
      },
    });

    if (result.ok) {
      showMessage('success', t('admin.nicknameRemoved', 'Account nickname removed successfully'));
      setNicknameForm({ awsAccountId: '', nickname: '' });
    } else {
      showMessage('error', result.error || t('admin.nicknameRemoveFailed', 'Failed to remove nickname'));
    }
  };

  return (
    <div style={cardStyle}>
      <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>
        {t('admin.manageNicknames', 'Manage Account Nicknames')}
      </h3>
      <form style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} onSubmit={(e) => e.preventDefault()}>
        <FocusInput
          type="text"
          placeholder={t('admin.accountIdPlaceholder', 'AWS Account ID (12 digits)')}
          value={nicknameForm.awsAccountId}
          onChange={(e) => setNicknameForm({ ...nicknameForm, awsAccountId: e.target.value })}
          pattern="[0-9]{12}"
          required
        />
        <FocusInput
          type="text"
          placeholder={t('admin.nicknamePlaceholder', 'Account Nickname')}
          value={nicknameForm.nickname}
          onChange={(e) => setNicknameForm({ ...nicknameForm, nickname: e.target.value })}
        />
        <div style={{ display: 'flex', gap: '16px' }}>
          <LoadingButton onClick={handleSetNickname} disabled={!isSetNicknameValid} variant="blue">
            {t('admin.setNickname', 'Set Nickname')}
          </LoadingButton>
          <LoadingButton onClick={handleRemoveNickname} disabled={!isRemoveNicknameValid} variant="red">
            {t('admin.removeNickname', 'Remove Nickname')}
          </LoadingButton>
        </div>
      </form>
    </div>
  );
}
