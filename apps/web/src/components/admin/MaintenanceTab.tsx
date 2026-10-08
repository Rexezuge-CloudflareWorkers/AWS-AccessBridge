'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cleanupOrphaned, type CleanupOrphanedResult } from '../../services/adminService';
import LoadingButton from '../ui/LoadingButton';
import { cardStyle } from '../ui/theme';
import type { ShowMessage } from '../../hooks/useToast';
import { toErrorMessage } from '../../lib/errors';

const CLEANUP_ROW_LABELS: Array<{ key: keyof CleanupOrphanedResult['deletedCounts']; label: string }> = [
  { key: 'awsAccounts', label: 'aws_accounts' },
  { key: 'roleConfigs', label: 'role_configs' },
  { key: 'teamAccounts', label: 'team_accounts' },
  { key: 'spendAlerts', label: 'spend_alerts' },
  { key: 'costData', label: 'cost_data' },
  { key: 'resourceInventory', label: 'resource_inventory' },
  { key: 'dataCollectionConfig', label: 'data_collection_config' },
];

export default function MaintenanceTab({ showMessage }: { showMessage: ShowMessage }) {
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState(false);
  const [lastResult, setLastResult] = useState<CleanupOrphanedResult | null>(null);

  const handleRunCleanup = async () => {
    if (!confirmed) return;

    try {
      const data = await cleanupOrphaned();
      setLastResult(data);
      setConfirmed(false);
      // A partial run still answers 200 by design — `cleanupOrphanedData` settles
      // each table independently and reports what failed. Reporting plain
      // "complete" here would tell the admin six of seven tables were cleaned
      // when one was not.
      if (data.failures.length > 0) {
        showMessage(
          'error',
          t('admin.cleanupPartial', 'Cleanup finished with {{failed}} table(s) failing — {{count}} row(s) removed', {
            failed: data.failures.length,
            count: data.totalDeleted,
          }),
        );
      } else {
        showMessage(
          'success',
          t('admin.cleanupDone', 'Cleanup complete — {{count}} orphaned row(s) removed', { count: data.totalDeleted }),
        );
      }
    } catch (err) {
      showMessage('error', toErrorMessage(err, t('admin.cleanupFailed', 'Failed to run cleanup')));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={cardStyle}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>{t('admin.purgeTitle', 'Purge Orphaned Data')}</h3>
        <p style={{ color: '#d1d5db', marginBottom: '16px' }}>
          {t(
            'admin.purgeDescription',
            'Deletes leftover rows for AWS accounts that no user has been granted access to and for credentials that no longer exist.',
          )}
        </p>
        <div
          style={{
            background: '#3f1d1d',
            border: '1px solid #7f1d1d',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
            color: '#fecaca',
            fontSize: '14px',
            lineHeight: 1.5,
          }}
        >
          <strong>{t('admin.purgeWarningStrong', 'Do not run this while setting up a new account.')}</strong>{' '}
          {t(
            'admin.purgeWarningRest',
            'If you have added an account nickname, credentials, or role config but have not yet granted access to any user, those rows will be treated as orphans and removed.',
          )}
        </div>
        <p style={{ color: '#9ca3af', marginBottom: '8px', fontSize: '14px' }}>
          {t('admin.tablesScanned', 'Tables that will be scanned:')}
        </p>
        <ul style={{ color: '#d1d5db', marginBottom: '24px', paddingLeft: '20px', fontSize: '14px', lineHeight: 1.8 }}>
          <li>
            <code>aws_accounts</code>, <code>role_configs</code>, <code>team_accounts</code>, <code>spend_alerts</code>,{' '}
            <code>cost_data</code>, <code>resource_inventory</code>{' '}
            {t('admin.purgeAccountNote', '— removed when the account has no grants.')}
          </li>
          <li>
            <code>data_collection_config</code> {t('admin.purgeCredentialNote', '— removed when the credential no longer exists.')}
          </li>
        </ul>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#d1d5db',
            cursor: 'pointer',
            marginBottom: '16px',
            fontSize: '14px',
          }}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            style={{ width: '18px', height: '18px', accentColor: '#dc2626', cursor: 'pointer' }}
          />
          {t('admin.purgeConfirm', 'I understand this will permanently delete orphaned rows.')}
        </label>
        <LoadingButton onClick={handleRunCleanup} disabled={!confirmed} variant="red">
          {t('admin.runCleanup', 'Run Cleanup')}
        </LoadingButton>
      </div>

      {lastResult && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>{t('admin.lastRunResults', 'Last Run Results')}</h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              gap: '8px 24px',
              alignItems: 'center',
              fontSize: '14px',
            }}
          >
            {CLEANUP_ROW_LABELS.map(({ key, label }) => (
              <CleanupResultRow key={key} label={label} count={lastResult.deletedCounts[key]} />
            ))}
            <div
              style={{
                gridColumn: '1 / -1',
                height: '1px',
                background: '#374151',
                marginTop: '8px',
                marginBottom: '8px',
              }}
            />
            <div style={{ color: '#d1d5db', fontWeight: 600 }}>{t('admin.totalDeleted', 'Total deleted')}</div>
            <div style={{ color: '#ffffff', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{lastResult.totalDeleted}</div>
            {/* Name the tables that failed. The route reports them precisely so an
                administrator can retry or investigate; dropping them left the
                per-table counts looking like a complete success. */}
            {lastResult.failures.length > 0 && (
              <div style={{ gridColumn: '1 / -1', color: '#fca5a5', fontSize: '0.875rem', marginTop: '8px' }}>
                {t('admin.cleanupFailedTables', 'Could not clean: {{tables}}', { tables: lastResult.failures.join(', ') })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CleanupResultRow({ label, count }: { label: string; count: number }) {
  const isZero = count === 0;
  return (
    <>
      <code style={{ color: isZero ? '#6b7280' : '#d1d5db' }}>{label}</code>
      <div style={{ color: isZero ? '#6b7280' : '#ffffff', fontVariantNumeric: 'tabular-nums' }}>{count}</div>
    </>
  );
}
