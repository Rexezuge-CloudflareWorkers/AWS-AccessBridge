import { describe, it, expect } from 'vitest';
import { formatBackendString, getBackendStrings } from '@aws-access-bridge/shared/i18n';
import { normalizeLanguage, detectInitialLanguage } from '../../apps/web/src/i18n';
import enTranslation from '../../apps/web/src/locales/en/translation.json';

describe('formatBackendString', () => {
  it('returns the template unchanged without params', () => {
    expect(formatBackendString('hello')).toBe('hello');
  });

  it('substitutes placeholders', () => {
    expect(formatBackendString('hi {{name}}, you have {{count}}', { name: 'Ada', count: 3 })).toBe('hi Ada, you have 3');
  });

  it('leaves unknown placeholders intact', () => {
    expect(formatBackendString('hi {{name}}', {})).toBe('hi {{name}}');
  });
});

describe('getBackendStrings', () => {
  it('returns English strings for supported and unknown locales', () => {
    expect(getBackendStrings('en').locale).toBe('en');
    expect(getBackendStrings('xx-unknown').locale).toBe('en');
  });
});

describe('web normalizeLanguage', () => {
  it('canonicalizes supported tags', () => {
    expect(normalizeLanguage('de')).toBe('de');
    expect(normalizeLanguage('zh-TW')).toBe('zh-TW');
    expect(normalizeLanguage('pt_br')).toBe('pt');
  });

  it('falls back to English for missing or unsupported tags', () => {
    expect(normalizeLanguage(null)).toBe('en');
    expect(normalizeLanguage(undefined)).toBe('en');
    expect(normalizeLanguage('xx')).toBe('en');
  });
});

describe('web detectInitialLanguage', () => {
  it('returns a supported language without a DOM', () => {
    expect(detectInitialLanguage()).toBe('en');
  });
});

describe('web en locale catalog', () => {
  it('has all sections consumed by components', () => {
    const sections = Object.keys(enTranslation);
    for (const section of ['nav', 'auth', 'common', 'accounts', 'modal', 'costs', 'resources', 'audit', 'teams', 'admin', 'onboarding']) {
      expect(sections).toContain(section);
    }
  });
});
