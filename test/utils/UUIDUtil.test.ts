import { describe, it, expect } from 'vitest';
import { UUIDUtil } from '@aws-access-bridge/shared/utils/UUIDUtil';

describe('UUIDUtil', () => {
  describe('getRandomUUID', () => {
    it('returns a string in UUID v4 format', () => {
      const uuid: string = UUIDUtil.getRandomUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('returns unique values on successive calls', () => {
      const uuid1: string = UUIDUtil.getRandomUUID();
      const uuid2: string = UUIDUtil.getRandomUUID();
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('getRandomUUIDNoDash', () => {
    it('returns a 32-character hex string without dashes', () => {
      const uuid: string = UUIDUtil.getRandomUUIDNoDash();
      expect(uuid).toMatch(/^[0-9a-f]{32}$/);
    });

    it('does not contain dashes', () => {
      const uuid: string = UUIDUtil.getRandomUUIDNoDash();
      expect(uuid).not.toContain('-');
    });

    it('returns unique values on successive calls', () => {
      const uuid1: string = UUIDUtil.getRandomUUIDNoDash();
      const uuid2: string = UUIDUtil.getRandomUUIDNoDash();
      expect(uuid1).not.toBe(uuid2);
    });
  });
});
