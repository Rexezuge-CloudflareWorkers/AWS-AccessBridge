import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en/translation.json';

export const SUPPORTED_LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'ja', 'zh-CN', 'zh-TW', 'ko'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'aws-access-bridge-lng';

const baseResources = {
  en: { translation: en },
} as const;

function canonicalizeTag(tag: string): string {
  const normalized = tag.trim().replaceAll('_', '-');
  const parts = normalized.split('-').filter(Boolean);
  if (parts.length === 0) return 'en';
  const language = (parts[0] ?? 'en').toLowerCase();
  if (parts.length === 1) return language;
  const rest = parts.slice(1).map((part: string) => (part.length === 2 ? part.toUpperCase() : part.toLowerCase()));
  return [language, ...rest].join('-');
}

export function normalizeLanguage(tag: string | null | undefined): SupportedLanguage {
  if (!tag || typeof tag !== 'string') return 'en';
  const canonical = canonicalizeTag(tag);
  if ((SUPPORTED_LANGUAGES as readonly string[]).includes(canonical)) {
    return canonical as SupportedLanguage;
  }
  const base = canonical.split('-', 1)[0]?.toLowerCase() ?? 'en';
  if (base === 'zh') return 'zh-CN';
  const match = (SUPPORTED_LANGUAGES as readonly string[]).find((l) => l.toLowerCase() === base);
  if (match) return match as SupportedLanguage;
  return 'en';
}

export function detectInitialLanguage(): SupportedLanguage {
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored) return normalizeLanguage(stored);
  } catch {
    // Ignore storage errors (private mode) and fall through.
  }
  try {
    const nav = typeof navigator === 'undefined' ? null : navigator.language;
    if (nav) return normalizeLanguage(nav);
  } catch {
    // Ignore and fall through to default.
  }
  return 'en';
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
