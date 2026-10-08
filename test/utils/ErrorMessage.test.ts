import { describe, it, expect } from 'vitest';
import { toErrorMessage } from '@aws-access-bridge/shared/utils';

describe('toErrorMessage', () => {
  it('returns the message of an Error', () => {
    expect(toErrorMessage(new TypeError('boom'))).toBe('boom');
  });

  it('passes a thrown string through', () => {
    expect(toErrorMessage('plain')).toBe('plain');
  });

  it('stringifies any other thrown value', () => {
    expect(toErrorMessage(42)).toBe('42');
    expect(toErrorMessage(null)).toBe('null');
    expect(toErrorMessage(undefined)).toBe('undefined');
  });
});
