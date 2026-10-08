const DEFAULT_LOCALE = 'en';

const SUPPORTED_LOCALES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'ja', 'zh-CN', 'zh-TW', 'ko'] as const;

type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

function canonicalizeLocaleTag(tag: string): string {
  const normalized = tag.trim().replaceAll('_', '-');
  const parts = normalized.split('-').filter(Boolean);
  if (parts.length === 0) return '';
  const language = (parts[0] ?? '').toLowerCase();
  if (parts.length === 1) return language;
  const rest = parts.slice(1).map((part, index) => {
    if (index === parts.length - 2 && part.length === 4) {
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }
    return part.length === 2 ? part.toUpperCase() : part.toLowerCase();
  });
  return [language, ...rest].join('-');
}

class LocaleUtility {
  public static isSupported(locale: string | null | undefined): boolean {
    if (!locale || typeof locale !== 'string') return false;
    const canonical = canonicalizeLocaleTag(locale);
    return (SUPPORTED_LOCALES as readonly string[]).includes(canonical);
  }

  public static normalize(locale: string | null | undefined): SupportedLocale {
    if (!locale || typeof locale !== 'string') return DEFAULT_LOCALE;
    const canonical = canonicalizeLocaleTag(locale);
    if ((SUPPORTED_LOCALES as readonly string[]).includes(canonical)) {
      return canonical as SupportedLocale;
    }
    const base = canonical.split('-', 1)[0]?.toLowerCase() ?? '';
    if (base === 'zh') return 'zh-CN';
    const baseMatch = (SUPPORTED_LOCALES as readonly string[]).find((s) => s.toLowerCase() === base);
    if (baseMatch) return baseMatch as SupportedLocale;
    try {
      const negotiated = Intl.getCanonicalLocales(canonical);
      const primary = negotiated[0]?.split('-', 1)[0]?.toLowerCase() ?? '';
      const fallback = (SUPPORTED_LOCALES as readonly string[]).find((s) => s.toLowerCase() === primary);
      if (fallback) return fallback as SupportedLocale;
    } catch {
      // Ignore invalid tags and fall through to default.
    }
    return DEFAULT_LOCALE;
  }
}

export { LocaleUtility as LocaleUtil, SUPPORTED_LOCALES };
export type { SupportedLocale };
