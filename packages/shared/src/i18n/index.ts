import type { BackendStrings } from './BackendStrings';
import { enStrings } from './locales/en';
import { deStrings } from './locales/de';
import { esStrings } from './locales/es';
import { frStrings } from './locales/fr';
import { itStrings } from './locales/it';
import { jaStrings } from './locales/ja';
import { koStrings } from './locales/ko';
import { nlStrings } from './locales/nl';
import { plStrings } from './locales/pl';
import { ptStrings } from './locales/pt';
import { zhCNStrings } from './locales/zh-CN';
import { zhTWStrings } from './locales/zh-TW';

const LOCALE_BUNDLES: Record<string, BackendStrings> = {
  en: enStrings,
  de: deStrings,
  es: esStrings,
  fr: frStrings,
  it: itStrings,
  ja: jaStrings,
  ko: koStrings,
  nl: nlStrings,
  pl: plStrings,
  pt: ptStrings,
  'zh-CN': zhCNStrings,
  'zh-TW': zhTWStrings,
};

function getBackendStrings(locale: string): BackendStrings {
  const normalized: string = locale.toLowerCase().split('-', 1)[0] ?? 'en';
  const match = Object.entries(LOCALE_BUNDLES).find(([tag]) => tag.toLowerCase() === normalized);
  return match?.[1] ?? enStrings;
}

export type { BackendStrings, SupportedLocale } from './BackendStrings';
export { formatBackendString } from './BackendStrings';
export { getBackendStrings };
