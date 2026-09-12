import { loadLanguage } from '../i18n';
import { LANGUAGE_STORAGE_KEY } from '../i18n';

export function persistLanguage(lng: string): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    // Ignore storage errors (private mode).
  }
  syncHtmlLang(lng);
}

export function syncHtmlLang(lng: string): void {
  try {
    document.documentElement.lang = lng;
  } catch {
    // Ignore when document is unavailable (SSR/test).
  }
}

export async function applyLanguage(lng: string): Promise<void> {
  await loadLanguage(lng);
  persistLanguage(lng);
}
