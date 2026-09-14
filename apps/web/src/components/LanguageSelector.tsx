'use client';

import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, normalizeLanguage } from '../i18n';

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

export default function LanguageSelector({
  value,
  onChange,
  disabled,
}: {
  value?: string;
  onChange: (lng: string) => void;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const unknownLabel = t('nav.unknownLanguage', 'Unknown');

  if (value === 'unknown') {
    return (
      <select
        aria-label={t('nav.language', 'Language')}
        value="unknown"
        disabled
        onChange={(e) => onChange(e.target.value)}
        className="text-sm"
        style={{ padding: '6px 8px', background: '#1e2433', borderRadius: '8px', border: 'none', color: '#d1d5db', cursor: 'pointer' }}
      >
        <option value="unknown">{unknownLabel}</option>
      </select>
    );
  }

  const current = normalizeLanguage(value ?? i18n.resolvedLanguage ?? i18n.language);

  return (
    <select
      value={current}
      disabled={disabled}
      onChange={(e) => {
        onChange(e.target.value);
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
