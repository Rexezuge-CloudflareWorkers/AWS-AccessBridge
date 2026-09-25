import type { SupportedLocale } from '../utils/LocaleUtil';

interface BackendStrings {
  readonly locale: SupportedLocale;
  readonly strings: Record<string, string>;
}

function formatBackendString(template: string, params?: Record<string, string | number>): string {
  return params ? Object.entries(params).reduce((acc, [key, value]) => acc.split(`{{${key}}}`).join(String(value)), template) : template;
}

export type { BackendStrings };
export { formatBackendString };
