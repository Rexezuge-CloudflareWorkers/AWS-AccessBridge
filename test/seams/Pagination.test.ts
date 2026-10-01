import { describe, it, expect } from 'vitest';
import { Pagination } from '@aws-access-bridge/backend-runtime/constants';

describe('Pagination.limit', () => {
  it('falls back to the default when nothing is supplied', () => {
    expect(Pagination.limit()).toBe(50);
    expect(Pagination.limit(null)).toBe(50);
    expect(Pagination.limit('')).toBe(50);
  });

  it('passes a value inside the range through', () => {
    expect(Pagination.limit(25)).toBe(25);
    expect(Pagination.limit('25')).toBe(25);
    expect(Pagination.limit(1)).toBe(1);
    expect(Pagination.limit(200)).toBe(200);
  });

  it('clamps to the range', () => {
    expect(Pagination.limit(0)).toBe(1);
    expect(Pagination.limit(-5)).toBe(1);
    expect(Pagination.limit(201)).toBe(200);
    expect(Pagination.limit(Number.MAX_SAFE_INTEGER)).toBe(200);
  });

  it('parses the string form a query parameter arrives as', () => {
    expect(Pagination.limit('  30 ')).toBe(30);
    expect(Pagination.limit('30.9')).toBe(30);
  });

  /**
   * `Math.min(Math.max(parseInt(...)))` returned `NaN` for a non-numeric query
   * parameter, which `LIMIT ?` then rejected at the database.
   */
  it.each(['abc', 'NaN', '1e999', 'Infinity'])('falls back to the default for %j rather than yielding NaN', (value) => {
    expect(Pagination.limit(value)).toBe(50);
    expect(Number.isNaN(Pagination.limit(value))).toBe(false);
  });
});

describe('Pagination.offset', () => {
  it('defaults to 0', () => {
    expect(Pagination.offset()).toBe(0);
    expect(Pagination.offset(null)).toBe(0);
    expect(Pagination.offset('')).toBe(0);
  });

  it('passes a non-negative value through', () => {
    expect(Pagination.offset(0)).toBe(0);
    expect(Pagination.offset(40)).toBe(40);
    expect(Pagination.offset('40')).toBe(40);
  });

  it('clamps a negative offset to 0 instead of passing OFFSET -5 to SQL', () => {
    expect(Pagination.offset(-1)).toBe(0);
    expect(Pagination.offset('-10')).toBe(0);
  });

  it('falls back to 0 for unparseable input', () => {
    expect(Pagination.offset('abc')).toBe(0);
    expect(Pagination.offset(Number.NaN)).toBe(0);
  });
});