import { describe, expect, it } from 'vitest';
import {
  checkCallSite,
  checkUnusedKeys,
  decodeLiteral,
  dynamicKeyFinding,
  hasDynamicCall,
  translationCalls,
} from '../../scripts/i18n/locale-checks';

/**
 * The `t()` call-site rules.
 *
 * This section exists as a pure module for exactly this reason. Its parser went
 * wrong three times while being written — once matching a string literal past its own
 * closing quote, once excluding an apostrophe a double-quoted default legally contains,
 * and once matching a default by searching forward and picking up a *later* call's
 * comma — and **no test caught any of them**, because until the rules were split out of
 * the entrypoint there was nothing to call. Both of the first two were caught only by
 * running the validator against the real corpus; the second is the worse failure, since
 * the affected call site simply stopped being checked and that looks identical to a
 * passing run.
 *
 * So every wrong shape is pinned here, and reintroducing one turns this file red.
 */
describe('translationCalls', () => {
  it('reads a key and its default from a single-quoted call', () => {
    expect(translationCalls(`t('brand.rest', 'Sonic')`)).toEqual([{ key: 'brand.rest', inlineDefault: 'Sonic' }]);
  });

  it('reads a key and its default from a double-quoted call', () => {
    expect(translationCalls(`t("brand.rest", "Sonic")`)).toEqual([{ key: 'brand.rest', inlineDefault: 'Sonic' }]);
  });

  it('accepts an apostrophe inside a double-quoted default', () => {
    // A shared `[^\\'"]` class rejects this and the call silently stops being checked.
    const source = `t('libraries.scanPaused', "D1's daily write allowance is spent.")`;
    expect(translationCalls(source)).toEqual([{ key: 'libraries.scanPaused', inlineDefault: "D1's daily write allowance is spent." }]);
  });

  it('accepts a double quote inside a single-quoted default', () => {
    expect(translationCalls(`t('a.b', 'say "hi"')`)).toEqual([{ key: 'a.b', inlineDefault: 'say "hi"' }]);
  });

  it('accepts an escaped quote in either delimiter', () => {
    expect(translationCalls(String.raw`t('a.b', 'it\'s here')`)).toEqual([{ key: 'a.b', inlineDefault: "it's here" }]);
    expect(translationCalls(String.raw`t('a.b', "say \"hi\"")`)).toEqual([{ key: 'a.b', inlineDefault: 'say "hi"' }]);
  });

  it('reports a one-argument call as having no default, which is not an empty default', () => {
    // `null` and `''` are different answers: the first means "nothing to compare", the
    // second means "compare against the empty string", and only one of them is a bug.
    expect(translationCalls(`t('nav.label')`)).toEqual([{ key: 'nav.label', inlineDefault: null }]);
  });

  it('stops one call at its own terminator', () => {
    // A shared `[^\\]` class matches the closing quote as readily as any other
    // character, so the capture runs on and swallows the rest of the file.
    const source = [`{t('a.one', 'first')}`, `{t('a.two', 'second')}`, `{t('a.three', 'third')}`].join('\n');
    expect(translationCalls(source)).toEqual([
      { key: 'a.one', inlineDefault: 'first' },
      { key: 'a.two', inlineDefault: 'second' },
      { key: 'a.three', inlineDefault: 'third' },
    ]);
  });

  it('mixes the two delimiters in one call, which the key and default choose independently', () => {
    // A pattern per delimiter for the whole call cannot express this: the key matches
    // one and the default the other, so the call reports no default and stops being
    // compared against the bundle.
    expect(translationCalls(`t('a.key', "a default")`)).toEqual([{ key: 'a.key', inlineDefault: 'a default' }]);
    expect(translationCalls(`t("a.key", 'a default')`)).toEqual([{ key: 'a.key', inlineDefault: 'a default' }]);
  });

  it('does not take a later call’s default as this one’s', () => {
    // The default is matched from where the key ended, and `T_DEFAULT` is sticky, so a
    // comma two calls down the line cannot be picked up as this call's.
    expect(translationCalls([`t('a.one')`, `, t('a.two', 'second')`].join(''))).toEqual([
      { key: 'a.one', inlineDefault: null },
      { key: 'a.two', inlineDefault: 'second' },
    ]);
  });

  it('handles a multi-line call, which is how the real source is written', () => {
    expect(translationCalls(`t(\n  'admin.hint',\n  'A library is an origin.',\n)`)).toEqual([
      { key: 'admin.hint', inlineDefault: 'A library is an origin.' },
    ]);
  });

  it('handles an interpolation object after the default, which is the third argument', () => {
    expect(translationCalls(`t('landing.hint', 'Check {{path}}.', { path: '/home' })`)).toEqual([
      { key: 'landing.hint', inlineDefault: 'Check {{path}}.' },
    ]);
  });

  it('is stable across repeated calls on the same source', () => {
    // `T_KEY` is a module-level `/g` regex. A `matchAll` that leaves `lastIndex` set
    // would make the second call return a suffix of the first, which reads as "some
    // call sites were not checked" and nothing else.
    const source = `t('a.one', 'One'); t('a.two', 'Two')`;
    const first = translationCalls(source);
    expect(translationCalls(source)).toEqual(first);
    expect(first).toHaveLength(2);
  });

  it('names a dynamically built key instead of skipping it silently', () => {
    expect(hasDynamicCall('t(`onboarding.step${n}`)')).toBe(true);
    expect(hasDynamicCall(`t('nav.label', 'Primary')`)).toBe(false);
  });
});

describe('decodeLiteral', () => {
  it('decodes the escapes locale strings actually use', () => {
    expect(decodeLiteral(String.raw`a\nb`)).toBe('a\nb');
    expect(decodeLiteral(String.raw`a\tb`)).toBe('a\tb');
    expect(decodeLiteral(String.raw`a\\b`)).toBe(String.raw`a\b`);
    expect(decodeLiteral(String.raw`it\'s`)).toBe("it's");
  });

  it('passes an unrecognised escape through rather than crashing', () => {
    // A validator that throws on an unfamiliar escape reports nothing at all, which is
    // worse than reporting a value it had to guess at.
    expect(decodeLiteral(String.raw`a\qb`)).toBe(String.raw`a\qb`);
  });
});

describe('checkCallSite', () => {
  const base = new Map([
    ['brand.rest', 'Sonic'],
    ['nav.label', 'Primary'],
    ['admin.systemHeader', 'SYSTEM'],
  ]);

  it('accepts a default that equals the bundle', () => {
    expect(checkCallSite('f.tsx', { key: 'brand.rest', inlineDefault: 'Sonic' }, base)).toEqual([]);
  });

  it('fails a default that disagrees with the bundle, case included', () => {
    // The `SYSTEM` / `System` case was a real finding in this repository, and it is the
    // whole class: the two disagree, and one of them is what a reader sees on the day
    // the key goes missing.
    const findings = checkCallSite('f.tsx', { key: 'admin.systemHeader', inlineDefault: 'System' }, base);
    expect(findings.map((finding) => finding.kind)).toEqual(['default-disagrees']);
    expect(findings[0]?.detail).toContain('"SYSTEM"');
    expect(findings[0]?.detail).toContain('"System"');
  });

  it('is fatal, unlike an absent key', () => {
    expect(checkCallSite('f.tsx', { key: 'brand.rest', inlineDefault: '-Sonic' }, base)[0]?.advisory).toBeUndefined();
  });

  it('names a key the bundle does not carry', () => {
    const findings = checkCallSite('f.tsx', { key: 'nope.missing', inlineDefault: 'X' }, base);
    expect(findings.map((finding) => finding.kind)).toEqual(['unknown-key']);
  });

  it('reports an absent key as advisory, because the fix needs a translator', () => {
    // A key used with an inline default and in no bundle renders untranslated for
    // everyone — a real defect. But the fix is one key per language, and the only way
    // to produce that here is to invent the translations, which is worse than an
    // absent key. So it is reported on every run rather than failing a merge nobody
    // can fix. Paired with the case above: one of these two is fatal and the other is
    // not, so the distinction has to be deliberate rather than accidental.
    const findings = checkCallSite('f.tsx', { key: 'nope.missing', inlineDefault: 'X' }, base);
    expect(findings[0]?.advisory).toBe(true);
    expect(findings[0]?.detail).toContain('untranslatable');
  });

  it('does not also report the default for a key that is absent', () => {
    // One defect, one finding. A second would restate the first and bury it.
    expect(checkCallSite('f.tsx', { key: 'nope.missing', inlineDefault: 'X' }, base)).toHaveLength(1);
  });

  it('has nothing to compare for a one-argument call', () => {
    expect(checkCallSite('f.tsx', { key: 'nav.label', inlineDefault: null }, base)).toEqual([]);
  });
});

describe('checkUnusedKeys', () => {
  const base = new Map([
    ['used.one', 'One'],
    ['used.two', 'Two'],
    ['never.used', 'Unused'],
  ]);

  it('names a bundle entry nothing renders', () => {
    const findings = checkUnusedKeys(base, new Set(['used.one', 'used.two']));
    expect(findings.map((finding) => finding.subject)).toEqual(['never.used']);
  });

  it('is advisory, because an unused entry is untidy rather than broken', () => {
    expect(checkUnusedKeys(base, new Set())[0]?.advisory).toBe(true);
  });

  it('finds nothing when every key is referenced', () => {
    expect(checkUnusedKeys(base, new Set(['used.one', 'used.two', 'never.used']))).toEqual([]);
  });
});

describe('dynamicKeyFinding', () => {
  it('names the file it could not check, and says so', () => {
    // A script that cannot see a call should say so rather than reporting coverage it
    // does not have.
    const finding = dynamicKeyFinding('apps/web/src/components/WizardProgress.tsx');
    expect(finding.kind).toBe('dynamic-key');
    expect(finding.advisory).toBe(true);
    expect(finding.detail).toContain('WizardProgress.tsx');
    expect(finding.detail).toContain('cannot be checked');
  });
});