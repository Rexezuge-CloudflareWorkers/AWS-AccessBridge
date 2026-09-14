import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocaleUtil } from '@aws-access-bridge/shared/utils';
import { getBackendStrings } from '@aws-access-bridge/shared/i18n';
import { normalizeLanguage, detectInitialLanguage } from '../../apps/web/src/i18n';
import enTranslation from '../../apps/web/src/locales/en/translation.json';
import deTranslation from '../../apps/web/src/locales/de/translation.json';
import frTranslation from '../../apps/web/src/locales/fr/translation.json';
import esTranslation from '../../apps/web/src/locales/es/translation.json';
import itTranslation from '../../apps/web/src/locales/it/translation.json';
import nlTranslation from '../../apps/web/src/locales/nl/translation.json';
import ptTranslation from '../../apps/web/src/locales/pt/translation.json';
import plTranslation from '../../apps/web/src/locales/pl/translation.json';
import jaTranslation from '../../apps/web/src/locales/ja/translation.json';
import zhCNTranslation from '../../apps/web/src/locales/zh-CN/translation.json';
import zhTWTranslation from '../../apps/web/src/locales/zh-TW/translation.json';
import koTranslation from '../../apps/web/src/locales/ko/translation.json';

const LOCALE_CATALOGS: Record<string, unknown> = {
  en: enTranslation,
  de: deTranslation,
  fr: frTranslation,
  es: esTranslation,
  it: itTranslation,
  nl: nlTranslation,
  pt: ptTranslation,
  pl: plTranslation,
  ja: jaTranslation,
  'zh-CN': zhCNTranslation,
  'zh-TW': zhTWTranslation,
  ko: koTranslation,
};

function flatKeys(value: unknown, prefix: string, out: string[]): void {
  if (typeof value === 'string') {
    out.push(prefix);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatKeys(child, prefix ? `${prefix}.${key}` : key, out);
    }
  }
}

function leafKeys(value: unknown): string[] {
  const out: string[] = [];
  flatKeys(value, '', out);
  return out.sort();
}

function leafValues(value: unknown): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [];
  const walk = (node: unknown, prefix: string): void => {
    if (typeof node === 'string') {
      entries.push({ key: prefix, value: node });
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        walk(child, prefix ? `${prefix}.${key}` : key);
      }
    }
  };
  walk(value, '');
  return entries;
}

describe('LocaleUtil', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recognizes the twelve supported tags', () => {
    for (const tag of Object.keys(LOCALE_CATALOGS)) {
      expect(LocaleUtil.isSupported(tag)).toBe(true);
    }
    expect(LocaleUtil.isSupported('xx')).toBe(false);
    expect(LocaleUtil.isSupported(null)).toBe(false);
  });

  it('canonicalizes underscore and case variants', () => {
    expect(LocaleUtil.normalize('de_DE')).toBe('de');
    expect(LocaleUtil.normalize('pt_br')).toBe('pt');
    expect(LocaleUtil.normalize('ZH-tw')).toBe('zh-TW');
    expect(LocaleUtil.normalize('en_US')).toBe('en');
  });

  it('falls back to zh-CN for bare zh and en for unknown', () => {
    expect(LocaleUtil.normalize('zh')).toBe('zh-CN');
    expect(LocaleUtil.normalize('xx')).toBe('en');
    expect(LocaleUtil.normalize(null)).toBe('en');
    expect(LocaleUtil.normalize(undefined)).toBe('en');
  });

  it('negotiates preferred over fallback', () => {
    expect(LocaleUtil.negotiate('de', 'fr')).toBe('de');
    expect(LocaleUtil.negotiate('xx', 'fr')).toBe('fr');
    expect(LocaleUtil.negotiate(null, null)).toBe('en');
  });

  it('resolves display names', () => {
    expect(LocaleUtil.displayName('de')).toBe('Deutsch');
    expect(LocaleUtil.displayName('xx')).toBe('English');
  });
});

describe('getBackendStrings', () => {
  it('resolves normalized locales and falls back to English', () => {
    expect(getBackendStrings('de').locale).toBe('en');
    expect(getBackendStrings('de_DE')).toBe(getBackendStrings('de'));
    expect(getBackendStrings(null).locale).toBe('en');
    expect(getBackendStrings(undefined).locale).toBe('en');
    expect(getBackendStrings('xx').locale).toBe('en');
  });
});

describe('web normalizeLanguage parity', () => {
  it('delegates to the shared canonicalization', () => {
    expect(normalizeLanguage('de')).toBe('de');
    expect(normalizeLanguage('de_DE')).toBe('de');
    expect(normalizeLanguage('zh-TW')).toBe('zh-TW');
    expect(normalizeLanguage('pt_br')).toBe('pt');
    expect(normalizeLanguage('zh')).toBe('zh-CN');
  });

  it('falls back to English for missing or unsupported tags', () => {
    expect(normalizeLanguage(null)).toBe('en');
    expect(normalizeLanguage(undefined)).toBe('en');
    expect(normalizeLanguage('xx')).toBe('en');
  });

  it('detects a supported initial language without a DOM', () => {
    expect(detectInitialLanguage()).toBe('en');
  });
});

describe('web locale catalogs', () => {
  it('ships exactly the twelve supported locales', () => {
    expect(Object.keys(LOCALE_CATALOGS).sort()).toEqual(
      ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'zh-CN', 'zh-TW'].sort(),
    );
  });

  it('exposes the same string keys as English in every locale', () => {
    const englishKeys = leafKeys(LOCALE_CATALOGS['en']);
    expect(englishKeys.length).toBeGreaterThan(0);
    for (const [locale, catalog] of Object.entries(LOCALE_CATALOGS)) {
      expect(leafKeys(catalog), `locale ${locale}`).toEqual(englishKeys);
    }
  });

  it('has no empty translations in any locale', () => {
    for (const [locale, catalog] of Object.entries(LOCALE_CATALOGS)) {
      for (const { key, value } of leafValues(catalog)) {
        expect(value.length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('translates at least the navigation shell beyond English copies', () => {
    for (const [locale, catalog] of Object.entries(LOCALE_CATALOGS)) {
      if (locale === 'en') continue;
      const values = new Map(leafValues(catalog).map((e) => [e.key, e.value] as const));
      const english = new Map(leafValues(LOCALE_CATALOGS['en']).map((e) => [e.key, e.value] as const));
      const translated = ['nav.accountsHeading', 'nav.costsHeading', 'nav.resourcesHeading'].filter(
        (key) => values.get(key) !== english.get(key),
      );
      expect(translated.length, `locale ${locale}`).toBeGreaterThan(0);
    }
  });

  it('keeps placeholder variables in sync with English', () => {
    const placeholderPattern = /\{\{[^}]+\}\}/g;
    const english = new Map(leafValues(LOCALE_CATALOGS['en']).map((e) => [e.key, e.value]));
    for (const [locale, catalog] of Object.entries(LOCALE_CATALOGS)) {
      if (locale === 'en') continue;
      for (const { key, value } of leafValues(catalog)) {
        const expected = [...(english.get(key) ?? '').matchAll(placeholderPattern)].map((m) => m[0]).sort();
        const actual = [...value.matchAll(placeholderPattern)].map((m) => m[0]).sort();
        expect(actual, `${locale}.${key}`).toEqual(expected);
      }
    }
  });
});
