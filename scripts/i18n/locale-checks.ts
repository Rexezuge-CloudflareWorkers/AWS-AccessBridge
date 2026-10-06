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
    | 'no-base-locale'
    // Call-site findings. Separate from the bundle-to-bundle kinds above
    // because they answer a different question: not "is this bundle internally
    // consistent" but "does the application agree with it".
    | 'unknown-key'
    | 'default-disagrees'
    | 'dynamic-key'
    | 'unused-key';
  /**
   * The locale tag or key the finding is about, or `''` for a whole-file
   * problem such as a bundle that will not parse.
   */
  subject: string;
  detail: string;
  /**
   * True for `dynamic-key` and `unused-key`, which describe a limit of this
   * script rather than a defect in the bundles. Reported, never fatal.
   */
  advisory?: boolean;
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

// ---------------------------------------------------------------------------
// Call sites
// ---------------------------------------------------------------------------
//
// Everything above is a comparison **between bundles**, so a key that is missing
// from *every* bundle passes it — which is the case this section exists for. With
// eleven shipped languages the per-tag body is well exercised, and a key absent
// from all eleven is invisible to it: the bundles agree with each other and all
// of them are wrong.
//
// So the keys are checked against the other direction too — every `t('…')` call
// under `apps/web/src` must resolve in the base bundle. That is a check a
// bundle-to-bundle diff cannot express, and it is the one that catches a key
// added to a component and forgotten everywhere else.

/**
 * The key argument of a `t()` call: `t('a.b.c'` or `t("a.b.c"`.
 *
 * A **backreference** closes the literal, not a character class, and that is the
 * whole trick. `\1` is whatever quote actually opened the argument, so the literal
 * ends at its own delimiter whatever that is — which is what a shared class
 * could not do. `[^\\']` breaks a double-quoted default containing an
 * apostrophe; `[^\\]` matches the closing quote itself and runs the capture past
 * its terminator, swallowing every later `t()` on the page. Both shapes shipped
 * before this was pinned by tests.
 */
const T_KEY = /\bt\(\s*(['"])([\w.]+)\1/g;

/**
 * The default argument, matched immediately after a key: `, 'default'` or
 * `, "default"`.
 *
 * A **separate pass** rather than an optional group on `T_KEY`, because the two
 * delimiters are independent: a call whose key is single-quoted and whose default
 * is double-quoted is legal and occurs here. A pattern per delimiter for the whole
 * call cannot express that — the key matches one and the default the other, so the
 * call reports no default and stops being compared against the bundle.
 *
 * Each branch is well under the repo's regex-complexity ceiling, which a single
 * alternated pattern is not: the version combining key and default scored 30
 * against a limit of 20.
 *
 * **Sticky**, not `exec`-and-hope. A sticky regex must match at `lastIndex`, so a
 * comma belonging to a *later* call cannot be picked up as this one's default.
 *
 * `\\.` consumes an escaped quote either way.
 */
const T_DEFAULT = /\s*,\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/y;

/**
 * A `t()` call whose first argument is a template literal, so its key cannot be
 * resolved.
 */
const DYNAMIC_T_CALL = /\bt\(\s*`/g;

/**
 * Decode a JS string literal as written in source.
 *
 * Only the escapes that appear in locale strings are handled, and an
 * unrecognised one is passed through as the backslash plus the character rather
 * than throwing — a validator that crashes on an unfamiliar escape reports
 * nothing at all, which is worse than reporting a value it had to guess at.
 */
export function decodeLiteral(raw: string): string {
  return raw.replaceAll(/\\(.)/g, (match, char: string) => {
    switch (char) {
      case 'n': {
        return '\n';
      }
      case 't': {
        return '\t';
      }
      case 'r': {
        return '\r';
      }
      case '\\':
      case "'":
      case '"':
      case '`': {
        return char;
      }
      default: {
        return match;
      }
    }
  });
}

/**
 * Every `t()` call in a source file, as `(key, default)`.
 *
 * `inlineDefault` is `null` for a one-argument call, which is a different thing
 * from a call whose default is the empty string.
 */
export function translationCalls(source: string): Array<{ key: string; inlineDefault: string | null }> {
  const calls: Array<{ key: string; inlineDefault: string | null }> = [];

  // `T_KEY` is a module-level `/g` regex, so its `lastIndex` is reset per call:
  // a caller that ran it earlier would otherwise start this one mid-file, which
  // reads as "some call sites were not checked" and nothing else.
  T_KEY.lastIndex = 0;
  for (const match of source.matchAll(T_KEY)) {
    const key = match[2];
    if (key === undefined) continue;

    // The default is matched from where the key ended, and `T_DEFAULT` is sticky,
    // so it can only match at that position.
    const afterKey = source.slice((match.index ?? 0) + match[0].length);
    T_DEFAULT.lastIndex = 0;
    const asDefault = T_DEFAULT.exec(afterKey);
    const rawDefault = asDefault?.[1] ?? asDefault?.[2];

    calls.push({ key, inlineDefault: rawDefault === undefined ? null : decodeLiteral(rawDefault) });
  }

  return calls;
}

/**
 * Whether a source file contains a `t()` call whose key cannot be resolved.
 */
export function hasDynamicCall(source: string): boolean {
  return DYNAMIC_T_CALL.test(source);
}

/**
 * Check one `t()` call site against the base bundle.
 *
 * ### Why the default is compared at all
 *
 * Every other check here compares two bundles or checks that a key exists.
 * None of them reads what a value **is**, so a bundle entry could say anything
 * and pass. That is how a header shipped reading `Edge--Sonic`: `brand.accent`
 * was "Edge", `brand.rest` was "-Sonic", and the component rendered its own `-`
 * separator between the two spans. Each of the three surfaces was individually
 * defensible — the bundle well-formed, the inline default saying what the
 * author intended, the markup correct — and the rendered string is only wrong to
 * somebody who already knows the product's name.
 *
 * So a default that disagrees with the shipped bundle **fails** rather than
 * warns: one of the two things it means is a bug. Either the bundle drifted from
 * the source, or the default is a lie that renders verbatim the day the key goes
 * missing — which is the fallback path this whole argument is about.
 */
export function checkCallSite(where: string, call: { key: string; inlineDefault: string | null }, base: FlatBundle): Finding[] {
  const findings: Finding[] = [];

  if (!base.has(call.key)) {
    // **Advisory, unlike `default-disagrees` next door.** A key used with an inline
    // default and absent from every bundle really is untranslatable — it renders the
    // English default for every user of every language, which is a live defect. But
    // the fix is thirteen keys times eleven languages, and the only way to produce
    // that here is to invent the translations: a wrong translation ships to users,
    // which is strictly worse than an absent one that renders English. So this is
    // reported on every run, where it is enumerable, rather than failing a merge
    // nobody can fix without a translator.
    //
    // It also cannot be "fixed" by adding the key to `en` alone: that would make the
    // other ten bundles report 13 `missing` keys each, so the debt would reappear as
    // a different and louder failure.
    findings.push({
      kind: 'unknown-key',
      subject: `${where}:${call.key}`,
      detail: `${where}: t('${call.key}') is not in the ${BASE_LOCALE} bundle — it renders as the inline default and is untranslatable`,
      advisory: true,
    });
    // A default cannot be compared against a key that is not there; the finding
    // above is the whole report, and a second would restate it and bury it.
    return findings;
  }

  if (call.inlineDefault === null) return findings;

  const bundled = base.get(call.key);
  if (bundled === call.inlineDefault) return findings;

  findings.push({
    kind: 'default-disagrees',
    subject: `${where}:${call.key}`,
    detail: `${where}: t('${call.key}', …) default disagrees with the ${BASE_LOCALE} bundle — ${BASE_LOCALE}=${JSON.stringify(bundled)} default=${JSON.stringify(call.inlineDefault)}`,
  });
  return findings;
}

/**
 * Keys in the base bundle that no `t()` call references.
 *
 * Advisory: a bundle accumulates entries nothing renders, which is untidy
 * rather than broken, and a key used from a file this scan does not reach is
 * reported here as though it were dead weight.
 */
export function checkUnusedKeys(base: FlatBundle, used: ReadonlySet<string>): Finding[] {
  return base
    .keys()
    .filter((key) => !used.has(key))
    .map((key) => ({
      kind: 'unused-key' as const,
      subject: key,
      detail: `${BASE_LOCALE} bundle: ${key} is never referenced by a t() call`,
      advisory: true,
    }))
    .toArray();
}

/**
 * A `t()` call whose key is built at runtime, which this script cannot check.
 *
 * Advisory, and deliberately reported: a script that cannot see a call should
 * say so rather than reporting coverage it does not have.
 */
export function dynamicKeyFinding(where: string): Finding {
  return {
    kind: 'dynamic-key',
    subject: where,
    detail: `${where}: a t() call builds its key dynamically and cannot be checked`,
    advisory: true,
  };
}
