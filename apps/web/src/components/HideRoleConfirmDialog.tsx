'use client';

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import type { HideDialogInfo } from './AccountRoleRow';

interface HideRoleConfirmDialogProps {
  info: HideDialogInfo;
  onCancel: () => void;
  onConfirm: (info: HideDialogInfo) => void;
}

/**
 * The portal-rendered hide/unhide confirmation, anchored to the role row that
 * opened it.
 *
 * Split out of `AccountList`, which was 405 lines of a fetch hook, a card list, and
 * a positioned popover. Any click, scroll, or resize dismisses it, which is why
 * the listeners live here with the dialog rather than in the list.
 */
export default function HideRoleConfirmDialog({ info, onCancel, onConfirm }: HideRoleConfirmDialogProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const close = (): void => onCancel();
    document.addEventListener('click', close);
    window.addEventListener('scroll', close, { capture: true });
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [onCancel]);

  if (typeof document === 'undefined') return null;

  const title = info.roleHidden ? t('accounts.confirmUnhideTitle', 'Unhide this role?') : t('accounts.confirmHideTitle', 'Hide this role?');

  return createPortal(
    <div
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={title}
      style={{
        position: 'fixed',
        top: info.top,
        right: info.right,
        background: '#111827',
        border: '1px solid #374151',
        borderRadius: '10px',
        padding: '10px 12px',
        boxShadow: '0 10px 20px -5px rgba(0, 0, 0, 0.6)',
        whiteSpace: 'nowrap',
        zIndex: 50,
      }}
    >
      {/* Arrow, rotated 45° to read as a diamond with two hidden edges. */}
      <div
        style={{
          position: 'absolute',
          top: '-5px',
          right: '10px',
          width: '10px',
          height: '10px',
          background: '#111827',
          borderLeft: '1px solid #374151',
          borderTop: '1px solid #374151',
          transform: 'rotate(45deg)',
        }}
      />
      <div style={{ fontSize: '12px', color: '#e5e7eb', marginBottom: '8px' }}>{title}</div>
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          style={{
            fontSize: '12px',
            padding: '4px 10px',
            borderRadius: '6px',
            background: 'transparent',
            color: '#9ca3af',
            border: '1px solid #374151',
            cursor: 'pointer',
          }}
        >
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onConfirm(info);
          }}
          style={{
            fontSize: '12px',
            padding: '4px 10px',
            borderRadius: '6px',
            background: info.roleHidden ? '#2563eb' : '#dc2626',
            color: '#ffffff',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          {info.roleHidden ? t('accounts.unhide', 'Unhide') : t('accounts.hide', 'Hide')}
        </button>
      </div>
    </div>,
    document.body,
  );
}