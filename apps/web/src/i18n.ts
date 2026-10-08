import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LocaleUtil } from '@aws-access-bridge/shared';
import { resolvePreferredLanguage } from './lib/language';
import en from './locales/en/translation.json';

export const SUPPORTED_LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'ja', 'zh-CN', 'zh-TW', 'ko'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'aws-access-bridge-lng';

const baseResources = {
  en: { translation: en },
} as const;

export function normalizeLanguage(tag: string | null | undefined): SupportedLanguage {
  return LocaleUtil.normalize(tag);
}

/**
 * The stored language choice, or `null` when there is none or storage is
 * unavailable (private mode throws on access).
 */
export function readStoredLanguage(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readNavigatorLanguage(): string | null {
  try {
    return typeof navigator === 'undefined' ? null : navigator.language;
  } catch {
    return null;
  }
}

/**
 * The language before the profile has loaded: stored choice, then the browser's,
 * then `en`. The precedence itself is `resolvePreferredLanguage` in `lib/language`.
 */
export function detectInitialLanguage(): SupportedLanguage {
  return resolvePreferredLanguage({ stored: readStoredLanguage(), navigatorLanguage: readNavigatorLanguage() });
}

/**
 * The language once the user is known: their saved backend preference wins, and
 * the same stored/browser chain applies underneath it.
 */
export function detectLanguageForUser(backendPreference: string | null | undefined): SupportedLanguage {
  return resolvePreferredLanguage({ backend: backendPreference, stored: readStoredLanguage(), navigatorLanguage: readNavigatorLanguage() });
}

const loadedLanguages = new Set<string>(['en']);

// Static glob so Vite emits one chunk per locale instead of relying on a
// variable dynamic import (which warns INEFFECTIVE_DYNAMIC_IMPORT and can 404
// under Workers Assets serving).
const localeModules = import.meta.glob('./locales/*/translation.json');

export async function loadLanguage(lng: string): Promise<void> {
  const normalized = normalizeLanguage(lng);
  if (loadedLanguages.has(normalized)) {
    await i18n.changeLanguage(normalized);
    return;
  }
  const loader = localeModules[`./locales/${normalized}/translation.json`];
  if (!loader) {
    throw new Error(`Unsupported language bundle: ${normalized}`);
  }
  let dict: Record<string, unknown>;
  try {
    const mod = (await loader()) as { default: Record<string, unknown> };
    dict = mod.default;
  } catch (error) {
    console.error(`Failed to load language bundle: ${normalized}`, error);
    throw error instanceof Error ? error : new Error(`Failed to load language bundle: ${normalized}`);
  }
  i18n.addResourceBundle(normalized, 'translation', dict, true, true);
  loadedLanguages.add(normalized);
  await i18n.changeLanguage(normalized);
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: baseResources,
    lng: detectInitialLanguage(),
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });
}
