'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AccessKeysResponse } from '@aws-access-bridge/shared';
import { exportEnv } from '@aws-access-bridge/shared';

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
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
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
          Access Keys
        </h2>
        <pre className="text-sm font-mono" style={{ ...modalStyles.preBlock, whiteSpace: 'pre-wrap' }}>
          export AWS_ACCESS_KEY_ID="{accessKeyId}"<br />
          export AWS_SECRET_ACCESS_KEY="{secretAccessKey}"<br />
          export AWS_SESSION_TOKEN="{sessionToken}"<br />
          <span style={{ color: '#6b7280' }}># Expiration: {expiration}</span>
        </pre>
        <div style={modalStyles.btnRow}>
          <button
            className="font-medium"
            style={modalStyles.btnCopy(copied)}
            onMouseEnter={(e) => (e.currentTarget.style.background = copied ? '#15803d' : '#1d4ed8')}
            onMouseLeave={(e) => (e.currentTarget.style.background = copied ? '#16a34a' : '#2563eb')}
            onClick={() => copyToClipboard(exportEnv(accessKeyId, secretAccessKey, sessionToken))}
          >
            {copied ? 'Copied!' : 'Copy All'}
          </button>
          <button
            className="font-medium"
            style={modalStyles.btnClose}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#4b5563')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#374151')}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
