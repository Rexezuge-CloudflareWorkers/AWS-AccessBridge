'use client';

import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, normalizeLanguage } from '../i18n';
import { applyLanguage } from '../lib/locale';
import { updatePreferredLanguage } from '../services/authService';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  nl: 'Nederlands',
  pt: 'Português',
  pl: 'Polski',
  ja: '日本語',
  ko: '한국어',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
};

async function changeLanguage(tag: string): Promise<void> {
  const normalized = normalizeLanguage(tag);
  try {
    await applyLanguage(normalized);
  } catch {
    return;
  }
  try {
    await updatePreferredLanguage(normalized);
  } catch {
    // Preference is best-effort; the local language already applied.
  }
}

export default function LanguageSelector() {
  const { t, i18n } = useTranslation();

  return (
    <select
      value={i18n.resolvedLanguage ?? 'en'}
      onChange={(e) => {
        void changeLanguage(e.target.value);
      }}
      aria-label={t('nav.language', 'Language')}
      className="text-sm"
      style={{ padding: '6px 8px', background: '#1e2433', borderRadius: '8px', border: 'none', color: '#d1d5db', cursor: 'pointer' }}
    >
      {SUPPORTED_LANGUAGES.map((lng) => (
        <option key={lng} value={lng}>
          {LANGUAGE_NAMES[lng] ?? lng}
        </option>
      ))}
    </select>
  );
}
