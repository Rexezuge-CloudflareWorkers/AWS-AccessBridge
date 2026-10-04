'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import AccessKeyModal from './AccessKeyModal';
import AccountRoleRow from './AccountRoleRow';
import type { HideDialogInfo } from './AccountRoleRow';
import HideRoleConfirmDialog from './HideRoleConfirmDialog';
import Spinner from './ui/Spinner';
import { isUnauthorized } from '../lib/api';
import { useRequestGuard } from '../hooks/useRequestGuard';
import { useAccountMutations } from '../hooks/useAccountMutations';
import { listAccounts } from '../services/accountService';
import type { ShowMessage } from '../hooks/useToast';

interface AccountListProps {
  showHidden: boolean;
  searchTerm: string;
  pageSize: number;
  currentPage: number;
  setTotalAccounts: (count: number) => void;
  showMessage: ShowMessage;
}

export default function AccountList({ showHidden, searchTerm, pageSize, currentPage, setTotalAccounts, showMessage }: AccountListProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // The search box and pagination both retrigger this fetch, so responses can
  // arrive out of order and a slow earlier one would render under a newer query.
  const { begin, isCurrent } = useRequestGuard();
  // Optimistic mutations and their loading state; see the hook for why the two
  // toggles roll back on failure.
  const { rolesData, setRolesData, loadingKeys, loadingConsole, modalData, setModalData, toggleFavorite, toggleHidden, openAccessKeys, openConsole } =
    useAccountMutations(showMessage, showHidden);

  useEffect(() => {
    const request = begin();
    listAccounts({ showHidden, searchTerm, pageSize, currentPage })
      .then(({ roles, total }) => {
        if (!isCurrent(request)) return;
        setRolesData(roles);
        setTotalAccounts(total);
        setExpanded(Object.fromEntries(Object.keys(roles).map((id) => [id, false])));
        setError(null);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!isCurrent(request)) return;
        if (isUnauthorized(err)) {
          globalThis.location.reload();
          return;
        }
        setError(err instanceof Error ? err.message : t('accounts.loadError', 'Failed to load AWS accounts'));
        setIsLoading(false);
      });
  }, [showHidden, searchTerm, pageSize, currentPage, setTotalAccounts, t, begin, isCurrent]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const [hoveredRole, setHoveredRole] = useState<string | null>(null);
  const [hoveredEye, setHoveredEye] = useState<string | null>(null);
  const [confirmHide, setConfirmHide] = useState<HideDialogInfo | null>(null);

  return (
    <div>
      {isLoading && <Spinner size={32} label={t('accounts.loading', 'Loading Accounts...')} padding="32px 0" />}
      {!isLoading && error && (
        <div
          style={{
            background: 'rgba(127, 29, 29, 0.3)',
            color: '#fca5a5',
            padding: '12px 16px',
            borderRadius: '12px',
            marginBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <svg style={{ width: '20px', height: '20px', marginRight: '8px', color: '#f87171' }} fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span>{error}</span>
          </div>
        </div>
      )}
      {!error && Object.keys(rolesData).length === 0 && !isLoading && (
        <div
          style={{
            background: '#1e2433',
            padding: '48px',
            borderRadius: '12px',
            textAlign: 'center',
          }}
        >
          <svg
            style={{ width: '48px', height: '48px', color: '#4b5563', margin: '0 auto 16px' }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <p style={{ fontSize: '18px', color: '#d1d5db', marginBottom: '8px' }}>{t('accounts.emptyTitle', 'No AWS accounts available')}</p>
          <p style={{ fontSize: '14px', color: '#6b7280' }}>
            {t('accounts.emptyHint', "You don't have access to any AWS accounts. Contact your administrator to request access.")}
          </p>
        </div>
      )}
      {!isLoading &&
        Object.entries(rolesData).map(([accountId, accountData]) => {
          const allRoles: Array<{ name: string; hidden: boolean }> = [
            ...accountData.roles.map((name) => ({ name, hidden: false })),
            ...(accountData.hiddenRoles ?? []).map((name) => ({ name, hidden: true })),
          ];
          return (
            <div
              key={accountId}
              className="animate-fade-in-up"
              style={{
                background: '#1e2433',
                borderRadius: '12px',
                padding: '16px',
                marginTop: '12px',
                marginBottom: '12px',
                color: '#ffffff',
                transition: 'background 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div
                  className="group"
                  style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1 }}
                  onClick={() => toggleExpand(accountId)}
                >
                  <svg
                    width="14"
                    height="14"
                    className="shrink-0 group-hover:text-gray-300"
                    style={{
                      marginRight: '12px',
                      color: '#6b7280',
                      transition: 'transform 0.2s, color 0.2s',
                      transform: expanded[accountId] ? 'rotate(90deg)' : 'rotate(0deg)',
                    }}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  <div className="font-semibold" style={{ fontSize: '16px' }}>
                    {accountData.nickname ? (
                      <>
                        <span style={{ color: '#f3f4f6' }}>{accountData.nickname}</span>{' '}
                        <span className="font-normal" style={{ color: '#6b7280', fontSize: '14px', marginLeft: '4px' }}>
                          {accountId}
                        </span>
                      </>
                    ) : (
                      <span className="font-mono" style={{ color: '#e5e7eb' }}>
                        {accountId}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => toggleFavorite(accountId)}
                  style={{
                    fontSize: '20px',
                    marginLeft: '16px',
                    transition: 'transform 0.15s',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                  title={
                    accountData.favorite
                      ? t('accounts.removeFavorite', 'Remove from favorites')
                      : t('accounts.addFavorite', 'Add to favorites')
                  }
                >
                  {accountData.favorite ? '\u{2B50}' : '\u{2606}'}
                </button>
              </div>
              <div
                style={{
                  overflow: 'hidden',
                  transition: 'max-height 0.2s ease-out, opacity 0.2s ease-out',
                  maxHeight: expanded[accountId] ? `${allRoles.length * 44 + 16}px` : '0px',
                  opacity: expanded[accountId] ? 1 : 0,
                }}
              >
                <div style={{ marginLeft: '28px', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {allRoles.map(({ name: role, hidden: roleHidden }) => (
                    <AccountRoleRow
                      key={role}
                      accountId={accountId}
                      role={role}
                      roleHidden={roleHidden}
                      loadingKeys={loadingKeys}
                      loadingConsole={loadingConsole}
                      hoveredRole={hoveredRole}
                      hoveredEye={hoveredEye}
                      confirmKey={confirmHide?.key ?? null}
                      onHoverRole={setHoveredRole}
                      onHoverEye={setHoveredEye}
                      onConsole={openConsole}
                      onAccessKeys={openAccessKeys}
                      onToggleHideDialog={setConfirmHide}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}

      {modalData && <AccessKeyModal {...modalData} onClose={() => setModalData(null)} />}

      {confirmHide && (
        <HideRoleConfirmDialog
          info={confirmHide}
          onCancel={() => setConfirmHide(null)}
          onConfirm={(info) => {
            setConfirmHide(null);
            void toggleHidden(info.accountId, info.role, info.roleHidden);
          }}
        />
      )}
    </div>
  );
}
