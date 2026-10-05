import { describe, expect, it } from 'vitest';
import {
  BASE_LOCALE,
  checkBaseLocale,
  checkBundle,
  checkTagListsAgree,
  checkTags,
  flatten,
  placeholdersOf,
  readDeclaredTags,
  type FlatBundle,
} from '../../scripts/i18n/locale-checks';

/**
A two-locale bundle shaped like the real ones, so the fixtures stay short.
*/
const bundle = (entries: Record<string, unknown>): FlatBundle => flatten(entries);

const base = bundle({ nav: { app: 'Bridge', save: 'Save {{name}}' }, common: { cancel: 'Cancel' } });

const kinds = (findings: { kind: string }[]): string[] => findings.map((finding) => finding.kind);
const subjects = (findings: { subject: string }[]): string[] => findings.map((finding) => finding.subject);

describe('flatten', () => {
  it('flattens nested objects into dotted keys', () => {
    expect([...flatten({ a: { b: { c: 'x' } }, d: 'y' })]).toEqual([
      ['a.b.c', 'x'],
      ['d', 'y'],
    ]);
  });

  it('keeps an array leaf as a single value rather than descending into it', () => {
    // An array is a leaf, so `a.0` never appears — which is what makes a shape
    // change between locales show up as an extra key instead of silently
    // comparing element by element.
    expect([...flatten({ a: ['x', 'y'] })]).toEqual([['a', ['x', 'y']]]);
  });

  it('throws on a non-object root, naming what it found', () => {
    expect(() => flatten([])).toThrow('expected an object, found an array');
    expect(() => flatten('x')).toThrow('expected an object, found string');
  });
});

describe('placeholdersOf', () => {
  it('returns distinct tokens, sorted, so order cannot mask a swap', () => {
    expect(placeholdersOf('{{b}} then {{a}} then {{b}}')).toEqual(['{{a}}', '{{b}}']);
  });

  it('returns nothing for a non-string or a value with no tokens', () => {
    expect(placeholdersOf(42)).toEqual([]);
    expect(placeholdersOf('plain')).toEqual([]);
  });
});

describe('checkBundle', () => {
  it('reports nothing for a bundle matching the base', () => {
    expect(
      checkBundle('de', base, bundle({ nav: { app: 'Brücke', save: '{{name}} speichern' }, common: { cancel: 'Abbrechen' } })),
    ).toEqual([]);
  });

  it('reports a key present in the base but missing here', () => {
    const findings = checkBundle('de', base, bundle({ nav: { app: 'Brücke', save: '{{name}} speichern' }, common: {} }));

    expect(kinds(findings)).toEqual(['missing']);
    expect(subjects(findings)).toEqual(['de:common.cancel']);
  });

  it('reports a key with no base source', () => {
    const findings = checkBundle('de', base, bundle({ nav: { app: 'B', save: '{{name}}' }, common: { cancel: 'C', extra: 'E' } }));

    expect(kinds(findings)).toEqual(['extra']);
    expect(subjects(findings)).toEqual(['de:common.extra']);
  });

  it('reports a placeholder mismatch and names both sides', () => {
    const findings = checkBundle('de', base, bundle({ nav: { app: 'B', save: '{{nom}}' }, common: { cancel: 'C' } }));

    expect(kinds(findings)).toEqual(['placeholder']);
    expect(findings[0]?.detail).toContain('base={{name}}');
    expect(findings[0]?.detail).toContain('de={{nom}}');
  });

  it('reports a placeholder dropped entirely', () => {
    expect(kinds(checkBundle('de', base, bundle({ nav: { app: 'B', save: 'S' }, common: { cancel: 'C' } })))).toEqual(['placeholder']);
  });

  it('reports an empty value', () => {
    expect(subjects(checkBundle('de', base, bundle({ nav: { app: '', save: 'S {{name}}' }, common: { cancel: 'C' } })))).toEqual([
      'de:nav.app',
    ]);
  });

  it('reports a non-string value, which t() cannot render', () => {
    expect(kinds(checkBundle('de', base, bundle({ nav: { app: 42, save: 'S {{name}}' }, common: { cancel: 'C' } })))).toEqual(['empty']);
  });

  it('reports several defects at once rather than only the first', () => {
    const findings = checkBundle('de', base, bundle({ nav: { app: '', save: '{{nom}}' }, common: {} }));

    expect(new Set(kinds(findings))).toEqual(new Set(['missing', 'empty', 'placeholder']));
  });
});

describe('checkBaseLocale', () => {
  it('reports an empty base bundle rather than comparing against nothing', () => {
    const findings = checkBaseLocale(BASE_LOCALE, new Map());

    expect(kinds(findings)).toEqual(['no-base-locale']);
  });

  it('reports an empty value in the base locale', () => {
    // The regression this whole change exists for. `en` is the fallback for every
    // missing key and the file new keys are added to first, and it used to be the
    // one bundle the loop skipped — so an empty value there passed validation
    // while every other locale was checked.
    const findings = checkBaseLocale(BASE_LOCALE, bundle({ nav: { app: '' }, common: { cancel: 'Cancel' } }));

    expect(kinds(findings)).toEqual(['empty']);
    expect(subjects(findings)).toEqual([`${BASE_LOCALE}:nav.app`]);
    expect(findings[0]?.detail).toContain('fallback for every missing key');
  });

  it('reports a non-string value in the base locale', () => {
    expect(kinds(checkBaseLocale(BASE_LOCALE, bundle({ nav: { app: 42 } })))).toEqual(['empty']);
  });

  it('reports nothing for a populated base locale', () => {
    expect(checkBaseLocale(BASE_LOCALE, base)).toEqual([]);
  });
});

describe('checkTags', () => {
  const onDisk = ['de', 'en', 'es'];

  it('reports nothing when the declared tags and the directories agree', () => {
    expect(checkTags(['en', 'de', 'es'], onDisk)).toEqual([]);
  });

  it('reports a declared tag with no directory', () => {
    // Makes loadLanguage throw at runtime, and no test covered it.
    const findings = checkTags(['en', 'de', 'es', 'sv'], onDisk);

    expect(kinds(findings)).toEqual(['undeclared-tag']);
    expect(subjects(findings)).toEqual(['sv']);
    expect(findings[0]?.detail).toContain('throws at runtime');
  });

  it('reports a directory that no declared tag names', () => {
    // A bundle nothing can ever load.
    const findings = checkTags(['en', 'de'], onDisk);

    expect(kinds(findings)).toEqual(['undeclared-directory']);
    expect(subjects(findings)).toEqual(['es']);
  });

  it('reports both directions when the sets have drifted apart', () => {
    const findings = checkTags(['en', 'sv'], ['en', 'xx']);

    expect(new Set(kinds(findings))).toEqual(new Set(['undeclared-tag', 'undeclared-directory']));
  });
});

describe('checkTagListsAgree', () => {
  it('reports nothing when both lists name the same locales', () => {
    expect(checkTagListsAgree(['en', 'de'], ['en', 'de'])).toEqual([]);
  });

  it('reports a tag the selector offers but normalize() would reject', () => {
    // Selectable in the UI, then silently falls back to English.
    const findings = checkTagListsAgree(['en', 'de', 'sv'], ['en', 'de']);

    expect(kinds(findings)).toEqual(['tag-list-mismatch']);
    expect(subjects(findings)).toEqual(['sv']);
    expect(findings[0]?.detail).toContain('normalize() falls back to English');
  });

  it('reports a tag LocaleUtil accepts but the selector cannot offer', () => {
    const findings = checkTagListsAgree(['en'], ['en', 'de']);

    expect(subjects(findings)).toEqual(['de']);
    expect(findings[0]?.detail).toContain('cannot offer it');
  });

  it('is order-insensitive, because the lists are declared in different orders', () => {
    expect(checkTagListsAgree(['en', 'de', 'es'], ['es', 'en', 'de'])).toEqual([]);
  });
});

describe('readDeclaredTags', () => {
  it('reads an exported const array', () => {
    expect(readDeclaredTags("export const SUPPORTED_LANGUAGES = ['en', 'zh-CN'] as const;", 'x.ts')).toEqual(['en', 'zh-CN']);
  });

  it('reads a non-exported const, which is how LocaleUtil declares it', () => {
    expect(readDeclaredTags("const SUPPORTED_LOCALES = ['en', 'de'] as const;", 'x.ts')).toEqual(['en', 'de']);
  });

  it('throws rather than returning nothing when the declaration is absent', () => {
    // A silently empty list would make every directory cross-check vacuously pass.
    expect(() => readDeclaredTags('const SOMETHING_ELSE = [];', 'x.ts')).toThrow('no SUPPORTED_LANGUAGES/SUPPORTED_LOCALES array literal');
  });

  it('throws when the array is present but empty', () => {
    expect(() => readDeclaredTags('const SUPPORTED_LOCALES = [] as const;', 'x.ts')).toThrow('is empty');
  });
});
