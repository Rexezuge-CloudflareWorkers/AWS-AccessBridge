'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_STORAGE_KEY, detectInitialLanguage, loadLanguage, normalizeLanguage } from '../i18n';
import { updatePreferredLanguage, type CurrentUser } from '../services/authService';

interface UseSpaLanguageInput {
  user: CurrentUser | null;
  setUser: (user: CurrentUser) => void;
  showMessage?: (type: 'success' | 'error', text: string) => void;
}

/**
 * Language state slice extracted from `SpaApp` so the shell stays thin.
 * Owns detection precedence (backend > localStorage > navigator > en),
 * `<html lang>` sync, and the blocking manual-change flow.
 * Ported from Mail-Otter `useSpaLanguage` for Otter parity.
 */
function useSpaLanguage({ user, setUser, showMessage }: UseSpaLanguageInput) {
  const [language, setLanguage] = useState<string>(() => detectInitialLanguage());
  const [languageStatus, setLanguageStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [languagePending, setLanguagePending] = useState(false);
  const languagePendingRef = useRef(false);
  const { i18n, t } = useTranslation();

  // Keep explicit language state in sync with i18next so the controlled
  // LanguageSelector re-renders even when only the i18n instance changes.
  useEffect(() => {
    const handler = (lng: string) => {
      setLanguage(normalizeLanguage(lng));
      setLanguageStatus('ready');
    };
    i18n.on('languageChanged', handler);
    return () => {
      i18n.off('languageChanged', handler);
    };
  }, [i18n]);

  useEffect(() => {
    if (!user || languagePendingRef.current) return;
    const preferred = normalizeLanguage(
      user.preferredLanguage ??
        (() => {
          try {
            return localStorage.getItem(LANGUAGE_STORAGE_KEY);
          } catch {
            return null;
          }
        })(),
    );
    let cancelled = false;
    setLanguageStatus('loading');
    loadLanguage(preferred)
      .then(() => {
        if (cancelled) return;
        setLanguage(preferred);
        setLanguageStatus('ready');
        try {
          document.documentElement.lang = preferred;
        } catch {
          // Ignore DOM errors in non-browser environments.
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLanguage('unknown');
        setLanguageStatus('error');
        showMessage?.('error', t('nav.languageLoadFailed', 'Unable To Load Language.'));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: user-only trigger + ref guard
  }, [user]);

  useEffect(() => {
    if (languageStatus === 'error') return;
    try {
      document.documentElement.lang = normalizeLanguage(language);
    } catch {
      // Ignore DOM errors in non-browser environments.
    }
  }, [language, languageStatus]);

  const handleLanguageChange = (lng: string) => {
    if (languagePending || languagePendingRef.current) return;
    const normalized = normalizeLanguage(lng);
    languagePendingRef.current = true;
    setLanguagePending(true);
    setLanguageStatus('loading');
    void (async () => {
      try {
        await loadLanguage(normalized);
        await updatePreferredLanguage(normalized);
        try {
          localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
        } catch {
          // Ignore storage errors.
        }
        if (user) {
          setUser({ ...user, preferredLanguage: normalized });
        }
        setLanguage(normalized);
        setLanguageStatus('ready');
      } catch {
        setLanguage('unknown');
        setLanguageStatus('error');
        showMessage?.('error', t('nav.languageSaveFailed', 'Unable To Save Language.'));
      } finally {
        languagePendingRef.current = false;
        setLanguagePending(false);
      }
    })();
  };

  return { language, languageStatus, languagePending, handleLanguageChange };
}

export { useSpaLanguage };
export type { UseSpaLanguageInput };
