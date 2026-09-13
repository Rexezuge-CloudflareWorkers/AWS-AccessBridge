'use client';

import { useTranslation } from 'react-i18next';

interface HideDialogInfo {
  key: string;
  accountId: string;
  role: string;
  roleHidden: boolean;
  top: number;
  right: number;
}

interface AccountRoleRowProps {
  accountId: string;
  role: string;
  roleHidden: boolean;
  loadingKeys: string | null;
  loadingConsole: string | null;
  hoveredRole: string | null;
  hoveredEye: string | null;
  confirmKey: string | null;
  onHoverRole: (key: string | null) => void;
  onHoverEye: (key: string | null) => void;
  onConsole: (accountId: string, role: string) => void;
  onAccessKeys: (accountId: string, role: string) => void;
  onToggleHideDialog: (info: HideDialogInfo | null) => void;
}

/**
 * Single role row extracted from `AccountList.tsx` (543-line god file
 * mixing fetching/pagination/favorites/hide-dialog/portal/modals).
 */
export default function AccountRoleRow({
  accountId,
  role,
  roleHidden,
  loadingKeys,
  loadingConsole,
  hoveredRole,
  hoveredEye,
  confirmKey,
  onHoverRole,
  onHoverEye,
  onConsole,
  onAccessKeys,
  onToggleHideDialog,
}: AccountRoleRowProps) {
  const { t } = useTranslation();
  const loadingKey = `${accountId}-${role}`;
  const isLoadingKeys = loadingKeys === loadingKey;
  const isLoadingConsole = loadingConsole === loadingKey;
  const isHovered = hoveredRole === loadingKey;
  const isEyeHovered = hoveredEye === loadingKey;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 12px',
        borderRadius: '8px',
        background: isHovered ? '#252d3d' : 'transparent',
        transition: 'background 0.15s',
        opacity: roleHidden ? 0.55 : 1,
      }}
      onMouseEnter={() => onHoverRole(loadingKey)}
      onMouseLeave={() => onHoverRole(null)}
    >
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          if (!isLoadingConsole) onConsole(accountId, role);
        }}
        className={`transition-colors ${isLoadingConsole ? 'text-gray-400 cursor-not-allowed' : 'text-blue-400 hover:text-blue-300'}`}
        style={{ textDecoration: 'none' }}
      >
        {isLoadingConsole ? t('accounts.openingConsole', 'Opening Console...') : role}
      </a>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirmKey === loadingKey) {
              onToggleHideDialog(null);
              return;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            onToggleHideDialog({
              key: loadingKey,
              accountId,
              role,
              roleHidden,
              top: rect.bottom + 10,
              right: Math.max(8, window.innerWidth - rect.right - 4),
            });
          }}
          onMouseEnter={() => onHoverEye(loadingKey)}
          onMouseLeave={() => onHoverEye(null)}
          title={roleHidden ? t('accounts.unhideRole', 'Unhide role') : t('accounts.hideRole', 'Hide role')}
          aria-label={roleHidden ? t('accounts.unhideRole', 'Unhide role') : t('accounts.hideRole', 'Hide role')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            padding: 0,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: isEyeHovered ? '#f87171' : '#6b7280',
            transition: 'color 0.15s',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
            <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
            {roleHidden && <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />}
          </svg>
        </button>
        <button
          className="text-sm"
          style={{
            transition: 'color 0.15s',
            color: isLoadingKeys ? '#9ca3af' : isHovered ? '#60a5fa' : '#6b7280',
            background: 'none',
            border: 'none',
            cursor: isLoadingKeys ? 'default' : 'pointer',
          }}
          onClick={() => onAccessKeys(accountId, role)}
          disabled={isLoadingKeys}
        >
          {isLoadingKeys ? t('common.loading', 'Loading...') : t('accounts.accessKeys', 'Access Keys')}
        </button>
      </div>
    </div>
  );
}

export type { AccountRoleRowProps, HideDialogInfo };
