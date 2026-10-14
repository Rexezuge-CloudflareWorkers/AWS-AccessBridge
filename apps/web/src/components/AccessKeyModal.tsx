'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '@rexezuge/web';
import type { AccessKeysResponse } from '@aws-access-bridge/shared';
import { formatShellExport } from '../lib/shellExport';

interface Props extends AccessKeysResponse {
  onClose: () => void;
}

/**
 * The access-key reveal, on the kit's `ModalShell`.
 *
 * The shell is the converged form of this dialog and of six copies elsewhere in
 * the family, and it is strictly more than the version it replaces: `aria-modal`
 * and an `aria-label` where this one had only `aria-label` and no role beyond
 * `dialog`, Escape and backdrop-click dismissal it had hand-rolled with two
 * separate listeners, and a named corner close button where this one had a bare
 * `✕` — or, on the credential modal, no dismissal affordance at all beyond
 * Escape.
 *
 * `widthClass` is the one thing this repo keeps: a 36rem card, which the shell's
 * 20rem default cannot hold a shell snippet in without wrapping every line.
 *
 * ### The clipboard handler is not the kit's
 *
 * `@rexezuge/web` has `useCopyToClipboard`, and its header is right that an
 * inlined handler leaks its timer and can report a copy that never happened. But
 * it reports failure by *silence* — `copied` simply never becomes true. That is
 * the honest answer to the question it was asked, and the wrong answer to this
 * one: a refused clipboard write here leaves a live AWS secret on screen and the
 * operator believing it is now on their clipboard, where they will paste it
 * somewhere and find nothing there. This component already reports the failure
 * in words and points at the snippet, which is the part the hook has no answer
 * for. The kit's `ModalShell` around it is adopted regardless; the handler stays
 * until a hook can carry the failure as well as the success.
 */
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

  return (
    <ModalShell
      onClose={onClose}
      ariaLabel={t('modal.accessKeysTitle', 'Access Keys')}
      closeLabel={t('common.close', 'Close')}
      widthClass="w-full max-w-[36rem] mx-4"
    >
      <h2 className="font-bold text-xl mb-4 text-[var(--color-text-primary)]">{t('modal.accessKeysTitle', 'Access Keys')}</h2>
      <pre className="text-sm font-mono bg-[var(--color-surface-base)] border border-[var(--color-border-muted)] p-4 rounded-xl overflow-x-auto text-[#d1d5db] whitespace-pre-wrap">
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
      <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
        <button
          className="font-medium px-4 py-2 rounded-lg border-none text-white transition-colors"
          style={{ background: copied ? '#16a34a' : '#2563eb' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = copied ? '#15803d' : '#1d4ed8')}
          onMouseLeave={(e) => (e.currentTarget.style.background = copied ? '#16a34a' : '#2563eb')}
          onClick={() => void copyToClipboard(formatShellExport(accessKeyId, secretAccessKey, sessionToken))}
        >
          {copied ? t('modal.copied', 'Copied!') : t('modal.copyAll', 'Copy All')}
        </button>
        <button
          className="font-medium px-4 py-2 rounded-lg border bg-[#374151] text-[#d1d5db] transition-colors"
          style={{ borderColor: '#4b5563' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#4b5563')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#374151')}
          onClick={onClose}
        >
          {t('common.close', 'Close')}
        </button>
      </div>
    </ModalShell>
  );
}
