import { LocaleUtil } from '@aws-access-bridge/shared';

type SupportedLanguageTag = ReturnType<typeof LocaleUtil.normalize>;

/**
 * The places a language preference can come from, in precedence order. Each is
 * `null`/`undefined` when unavailable.
 */
interface LanguageSources {
  /**
  `GET /user/me` `preferredLanguage` — authoritative once the user is known.
  */
  backend?: string | null;
  /**
  `localStorage('aws-access-bridge-lng')`.
  */
  stored?: string | null;
  /**
  `navigator.language`.
  */
  navigatorLanguage?: string | null;
}

/**
 * Picks the language: backend > localStorage > navigator > `en`.
 *
 * The first source that is **present** wins, and is then normalised — so an
 * unsupported backend value falls to `en` rather than to the next source. That is
 * deliberate: the backend value is the user's own choice, and silently replacing
 * it with whatever the browser reports would flip the UI the moment the profile
 * loaded.
 *
 * `useSpaLanguage` used to leave `navigator` out of this chain once a user was
 * loaded, so a first-time visitor with no stored choice was reset to `en` over a
 * browser that reported `de`.
 */
function resolvePreferredLanguage(sources: LanguageSources): SupportedLanguageTag {
  const chosen = [sources.backend, sources.stored, sources.navigatorLanguage].find((value) => typeof value === 'string' && value !== '');
  return LocaleUtil.normalize(chosen);
}

export type { LanguageSources };
export { resolvePreferredLanguage };
