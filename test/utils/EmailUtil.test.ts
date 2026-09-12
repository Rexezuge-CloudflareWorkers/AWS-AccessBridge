import { describe, it, expect } from 'vitest';
import { EmailUtil } from '@aws-access-bridge/shared/utils/EmailUtil';

describe('EmailUtil', () => {
  describe('extractUsername', () => {
    it('extracts username from a standard email', () => {
      expect(EmailUtil.extractUsername('user@example.com')).toBe('user');
    });

    it('extracts username with dots and plus signs', () => {
      expect(EmailUtil.extractUsername('first.last+tag@example.com')).toBe('first.last+tag');
    });

    it('throws for empty string', () => {
      expect(() => EmailUtil.extractUsername('')).toThrow('Invalid email address.');
    });

    it('throws for string without @', () => {
      expect(() => EmailUtil.extractUsername('no-at-sign')).toThrow('Invalid email address.');
    });

    it('throws for email starting with @', () => {
      expect(() => EmailUtil.extractUsername('@example.com')).toThrow('Email address missing local part before "@".');
    });

    it('handles email with multiple @ signs (takes first occurrence)', () => {
      expect(EmailUtil.extractUsername('user@domain@extra')).toBe('user');
    });
  });

  describe('extractDomain', () => {
    it('extracts domain from a standard email', () => {
      expect(EmailUtil.extractDomain('user@example.com')).toBe('example.com');
    });

    it('extracts domain with subdomain', () => {
      expect(EmailUtil.extractDomain('user@mail.example.co.uk')).toBe('mail.example.co.uk');
    });

    it('throws for empty string', () => {
      expect(() => EmailUtil.extractDomain('')).toThrow('Invalid email address.');
    });

    it('throws for string without @', () => {
      expect(() => EmailUtil.extractDomain('no-at-sign')).toThrow('Invalid email address.');
    });

    it('throws for email ending with @', () => {
      expect(() => EmailUtil.extractDomain('user@')).toThrow('Email address missing domain part after "@".');
    });

    it('handles email with multiple @ signs (takes first @)', () => {
      expect(EmailUtil.extractDomain('user@domain@extra')).toBe('domain@extra');
    });
  });
});
