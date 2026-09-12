type SupportedLocale = 'en';

interface BackendStrings {
  readonly locale: SupportedLocale;
  readonly strings: Record<string, string>;
}

function formatBackendString(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return Object.entries(params).reduce((acc, [key, value]) => acc.split(`{{${key}}}`).join(String(value)), template);
}

export type { SupportedLocale, BackendStrings };
export { formatBackendString };
