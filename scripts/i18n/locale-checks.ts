/**
 * The rules behind `scripts/i18n/validate_locales.ts`.
 *
 * Pure and exported so every rule is testable without touching the filesystem.
 *
 * ### Why this is a module and not the entrypoint
 *
 * The rules used to live inline in the entrypoint, which is why two of them were
 * wrong: nothing could regression-test them, and a passing run could not
 * distinguish "no defects" from "the defects are in the part nobody checks". The
 * `en` empty-value gap in particular was invisible for exactly that reason — `en`
 * is the fallback for every missing key, and it was the one bundle the loop
 * skipped.
 */

/**
 * One validation failure. `detail` is operator-facing prose and is kept out of
 * `kind` so tests can assert on the kind without depending on the wording.
 */
export interface Finding {
  kind:
    | 'malformed'
    | 'missing'
    | 'extra'
    | 'empty'
    | 'placeholder'
    | 'undeclared-directory'
    | 'undeclared-tag'
    | 'tag-list-mismatch'
    | 'no-base-locale';
  /**
   * The locale tag or key the finding is about, or `''` for a whole-file
   * problem such as a bundle that will not parse.
   */
  subject: string;
  detail: string;
}

/**
 * A flattened translation bundle: dotted key path to leaf value.
 */
export type FlatBundle = Map<string, unknown>;

/**
 * The locale tag every other tag is compared against.
 */
export const BASE_LOCALE = 'en';

/**
 * Matches one `{{placeholder}}` token.
 *
 * `[^{}]` rather than `.*?` so the pattern cannot backtrack across a long
 * translation string looking for a closing brace that is not there.
 */
const PLACEHOLDER = /\{\{[^{}]+\}\}/g;

/**
 * The `const NAME = ['a', 'b'] as const;` array literal, captured per source file.
 *
 * Parsed from text rather than imported. `apps/web/src/i18n.ts` calls
 * `import.meta.glob`, which is a Vite transform — importing that module under
 * plain `tsx` throws `define_import_meta_default.glob is not a function`, so the
 * tags are unreachable by any other means.
 */
const TAG_ARRAY = /(?:export )?const (?:SUPPORTED_LANGUAGES|SUPPORTED_LOCALES) = \[([^\]]*)\]/;

/**
 * Flattens a nested translation object into dotted keys.
 *
 * @throws when a leaf is reached through a non-object, which is a bundle whose
 *   root is an array or a scalar rather than a section map.
 */
export function flatten(node: unknown, prefix = '', out: FlatBundle = new Map()): FlatBundle {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    throw new Error(`expected an object, found ${Array.isArray(node) ? 'an array' : typeof node} at ${prefix || '<root>'}`);
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      flatten(value, keyPath, out);
    } else {
      out.set(keyPath, value);
    }
  }
  return out;
}

/**
 * The distinct `{{placeholder}}` tokens in a value, sorted for comparison.
 */
export function placeholdersOf(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  const matches = value.match(PLACEHOLDER) ?? [];
  return Array.from(new Set(matches)).toSorted((a, b) => a.localeCompare(b));
}

/**
 * Keys whose value is not a usable string.
 *
 * Applied to the base locale as well as the others. A non-string leaf is not
 * renderable by `t()`, and an empty string is indistinguishable from a missing
 * key at the call site because every call passes an English default — so in `en`
 * an empty value is what a user actually sees.
 */
function emptyValues(bundle: FlatBundle): string[] {
  return [...bundle].filter(([, value]) => typeof value !== 'string' || value === '').map(([key]) => key);
}

/**
 * Compares one bundle against the base locale.
 *
 * Key parity, placeholder parity, and non-empty string values. `en` is checked
 * by this same function, which is the point: the base locale is the fallback for
 * every missing key, so a defect there is the one that reaches the most users.
 */
export function checkBundle(tag: string, base: FlatBundle, bundle: FlatBundle): Finding[] {
  const findings: Finding[] = [];

  const missing = base
    .keys()
    .filter((key) => !bundle.has(key))
    .toArray();
  const extra = bundle
    .keys()
    .filter((key) => !base.has(key))
    .toArray();
  const empty = emptyValues(bundle);

  const placeholderMismatches = base
    .keys()
    .filter((key) => {
      if (!bundle.has(key)) {
        return false;
      }
      const expected = placeholdersOf(base.get(key));
      const actual = placeholdersOf(bundle.get(key));
      return expected.length !== actual.length || expected.some((token, index) => token !== actual[index]);
    })
    .toArray();

  for (const key of missing) {
    findings.push({ kind: 'missing', subject: `${tag}:${key}`, detail: 'is present in the base locale but not here' });
  }
  for (const key of extra) {
    findings.push({ kind: 'extra', subject: `${tag}:${key}`, detail: 'has no base-locale source' });
  }
  for (const key of empty) {
    findings.push({ kind: 'empty', subject: `${tag}:${key}`, detail: 'is empty or not a string' });
  }
  for (const key of placeholderMismatches) {
    const expected = placeholdersOf(base.get(key)).join(',');
    const actual = placeholdersOf(bundle.get(key)).join(',');
    findings.push({
      kind: 'placeholder',
      subject: `${tag}:${key}`,
      detail: `placeholder mismatch (base=${expected || 'none'} vs ${tag}=${actual || 'none'})`,
    });
  }

  return findings;
}

/**
 * Reads the tag list out of a source file that declares one.
 *
 * @throws when the declaration is absent or holds no tags, because a silently
 *   empty tag list would make the directory cross-check vacuously pass.
 */
export function readDeclaredTags(source: string, file: string): string[] {
  const match = TAG_ARRAY.exec(source);
  if (!match) {
    throw new Error(`no SUPPORTED_LANGUAGES/SUPPORTED_LOCALES array literal in ${file}`);
  }
  const tags = (match[1] ?? '')
    .matchAll(/'([^']+)'/g)
    .map((entry) => entry[1] as string)
    .toArray();
  if (tags.length === 0) {
    throw new Error(`the tag array in ${file} is empty`);
  }
  return tags;
}

/**
 * Cross-checks the declared tag lists against each other and the directories on
 * disk.
 *
 * Three lists name the same 12 locales — `SUPPORTED_LANGUAGES` in the web `i18n`
 * module, `SUPPORTED_LOCALES` in the shared `LocaleUtil`, and the
 * `locales/<tag>/` directories — and nothing tied them together. A tag declared
 * with no directory makes `loadLanguage` throw at runtime; a directory with no
 * declared tag is a bundle nothing can ever load.
 */
export function checkTags(declared: readonly string[], onDisk: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  const declaredSet = new Set(declared);
  const diskSet = new Set(onDisk);

  for (const tag of declared) {
    if (!diskSet.has(tag)) {
      findings.push({
        kind: 'undeclared-tag',
        subject: tag,
        detail: 'is declared as a supported language but has no locales/<tag>/translation.json, so loading it throws at runtime',
      });
    }
  }

  for (const tag of onDisk) {
    if (!declaredSet.has(tag)) {
      findings.push({
        kind: 'undeclared-directory',
        subject: tag,
        detail: 'has a locale directory but is not a declared language, so nothing can load it',
      });
    }
  }

  return findings;
}

/**
 * Compares the two declared tag lists, which must name the same locales.
 *
 * `LocaleUtil` is the one that decides what `normalize()` accepts, so a tag
 * present in the web selector but absent there is selectable and then silently
 * falls back to English.
 */
export function checkTagListsAgree(web: readonly string[], shared: readonly string[]): Finding[] {
  const webSet = new Set(web);
  const sharedSet = new Set(shared);
  const findings: Finding[] = [];

  for (const tag of web) {
    if (!sharedSet.has(tag)) {
      findings.push({
        kind: 'tag-list-mismatch',
        subject: tag,
        detail: 'is in SUPPORTED_LANGUAGES but not SUPPORTED_LOCALES, so normalize() falls back to English',
      });
    }
  }
  for (const tag of shared) {
    if (!webSet.has(tag)) {
      findings.push({
        kind: 'tag-list-mismatch',
        subject: tag,
        detail: 'is in SUPPORTED_LOCALES but not SUPPORTED_LANGUAGES, so the selector cannot offer it',
      });
    }
  }

  return findings;
}

/**
 * The base-locale check, kept separate so a missing or empty `en` is reported
 * before anything is compared against it.
 */
export function checkBaseLocale(tag: string, bundle: FlatBundle): Finding[] {
  if (bundle.size === 0) {
    return [{ kind: 'no-base-locale', subject: tag, detail: 'is empty, so every other bundle is compared against nothing' }];
  }
  return emptyValues(bundle).map((key) => ({
    kind: 'empty' as const,
    subject: `${tag}:${key}`,
    detail: 'is empty or not a string in the base locale, which is the fallback for every missing key',
  }));
}
