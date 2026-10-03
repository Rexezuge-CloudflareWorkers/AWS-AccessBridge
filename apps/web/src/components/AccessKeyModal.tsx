'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import type { AccessKeysResponse } from '@aws-access-bridge/shared';
import { formatShellExport } from '../lib/shellExport';

interface Props extends AccessKeysResponse {
  onClose: () => void;
}

const modalStyles = {
  backdrop: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 50,
  } as React.CSSProperties,
  card: {
    background: '#1e2433',
    border: '1px solid rgba(55,65,81,0.5)',
    color: 'white',
    padding: '24px',
    borderRadius: '16px',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
    width: '100%',
    maxWidth: '36rem',
    margin: '0 16px',
  } as React.CSSProperties,
  title: {
    fontSize: '1.25rem',
    color: '#f3f4f6',
    marginBottom: '16px',
  } as React.CSSProperties,
  preBlock: {
    background: '#111827',
    border: '1px solid rgba(55,65,81,0.5)',
    padding: '16px',
    borderRadius: '12px',
    overflowX: 'auto' as const,
    color: '#d1d5db',
  } as React.CSSProperties,
  btnRow: {
    marginTop: '24px',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
  } as React.CSSProperties,
  btnCopy: (isCopied: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    borderRadius: '8px',
    border: 'none',
    color: 'white',
    background: isCopied ? '#16a34a' : '#2563eb',
    transition: 'background 0.2s',
  }),
  btnClose: {
    background: '#374151',
    border: '1px solid #4b5563',
    padding: '8px 16px',
    borderRadius: '8px',
    color: '#d1d5db',
    transition: 'background 0.15s',
  } as React.CSSProperties,
};

export default function AccessKeyModal({ accessKeyId, secretAccessKey, sessionToken, expiration, onClose }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const shellExport = formatShellExport(accessKeyId, secretAccessKey, sessionToken);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Previously `console.error` only, so the user clicked "Copy All" and
      // nothing happened at all — no state change, no explanation. Clipboard
      // access is denied in several real cases (non-secure context, no
      // permission, a Firefox focus quirk), so this path is reachable in
      // production, not theoretical. The snippet is on screen; saying so lets
      // the user copy it by hand.
      console.error('Failed to copy:', err);
      setCopied(false);
      setCopyFailed(true);
    }
  };

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    globalThis.addEventListener('keydown', handleEsc);
    return () => globalThis.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="animate-backdrop-in"
      style={modalStyles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="animate-fade-in" style={modalStyles.card}>
        <h2 className="font-bold" style={modalStyles.title}>
          {t('modal.accessKeysTitle', 'Access Keys')}
        </h2>
        <pre className="text-sm font-mono" style={{ ...modalStyles.preBlock, whiteSpace: 'pre-wrap' }}>
          {/* `shellExport` is the same string the Copy All button hands the
              clipboard, so the displayed snippet and the copied one cannot
              drift — they were previously spelled twice. */}
          {shellExport.split('\n').map((line, index) => (
            <span key={line}>
              {line}
              {index < shellExport.split('\n').length - 1 && <br />}
            </span>
          ))}
          <br />
          <span style={{ color: '#6b7280' }}># {t('modal.expiresLabel', 'Expires: {{expiration}}', { expiration })}</span>
        </pre>
        {copyFailed && (
          <p style={{ color: '#fca5a5', fontSize: '0.75rem', marginTop: '8px' }}>
            {t('modal.copyFailed', 'Clipboard access was blocked. Select the snippet above and copy it manually.')}
          </p>
        )}
        <div style={modalStyles.btnRow}>
          <button
            className="font-medium"
            style={modalStyles.btnCopy(copied)}
            onMouseEnter={(e) => (e.currentTarget.style.background = copied ? '#15803d' : '#1d4ed8')}
            onMouseLeave={(e) => (e.currentTarget.style.background = copied ? '#16a34a' : '#2563eb')}
            onClick={() => copyToClipboard(formatShellExport(accessKeyId, secretAccessKey, sessionToken))}
          >
            {copied ? t('modal.copied', 'Copied!') : t('modal.copyAll', 'Copy All')}
          </button>
          <button
            className="font-medium"
            style={modalStyles.btnClose}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#4b5563')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#374151')}
            onClick={onClose}
          >
            {t('common.close', 'Close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
