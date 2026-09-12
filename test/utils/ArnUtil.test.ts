import { describe, it, expect } from 'vitest';
import { ArnUtil } from '@aws-access-bridge/backend-services/aws/ArnUtil';
import { BadRequestError } from '@aws-access-bridge/backend-errors';

describe('ArnUtil', () => {
  describe('getAccountIdFromArn', () => {
    it('extracts account ID from a valid IAM role ARN', () => {
      expect(ArnUtil.getAccountIdFromArn('arn:aws:iam::123456789012:role/MyRole')).toBe('123456789012');
    });

    it('extracts account ID from a valid IAM user ARN', () => {
      expect(ArnUtil.getAccountIdFromArn('arn:aws:iam::987654321098:user/MyUser')).toBe('987654321098');
    });

    it('extracts account ID from ARN with region and service', () => {
      expect(ArnUtil.getAccountIdFromArn('arn:aws:s3:us-east-1:111222333444:bucket/my-bucket')).toBe('111222333444');
    });

    it('throws BadRequestError for ARN with too few parts', () => {
      expect(() => ArnUtil.getAccountIdFromArn('arn:aws:iam')).toThrow(BadRequestError);
      expect(() => ArnUtil.getAccountIdFromArn('arn:aws:iam')).toThrow('Invalid ARN format');
    });

    it('throws BadRequestError for empty string', () => {
      expect(() => ArnUtil.getAccountIdFromArn('')).toThrow(BadRequestError);
    });

    it('throws BadRequestError for non-12-digit account ID', () => {
      expect(() => ArnUtil.getAccountIdFromArn('arn:aws:iam::12345:role/MyRole')).toThrow('Invalid AWS Account ID');
    });

    it('throws BadRequestError for non-numeric account ID', () => {
      expect(() => ArnUtil.getAccountIdFromArn('arn:aws:iam::abcdefghijkl:role/MyRole')).toThrow('Invalid AWS Account ID');
    });

    it('throws BadRequestError for account ID with letters mixed in', () => {
      expect(() => ArnUtil.getAccountIdFromArn('arn:aws:iam::12345678901a:role/MyRole')).toThrow('Invalid AWS Account ID');
    });
  });

  describe('getRoleNameFromArn', () => {
    it('extracts role name from a valid IAM role ARN', () => {
      expect(ArnUtil.getRoleNameFromArn('arn:aws:iam::123456789012:role/MyRole')).toBe('MyRole');
    });

    it('extracts role name with hyphens and underscores', () => {
      expect(ArnUtil.getRoleNameFromArn('arn:aws:iam::123456789012:role/My-Role_Name')).toBe('My-Role_Name');
    });

    it('throws BadRequestError for ARN with too few parts', () => {
      expect(() => ArnUtil.getRoleNameFromArn('arn:aws:iam')).toThrow(BadRequestError);
      expect(() => ArnUtil.getRoleNameFromArn('arn:aws:iam')).toThrow('Invalid IAM Role ARN format');
    });

    it('throws BadRequestError for non-role ARN resource type', () => {
      expect(() => ArnUtil.getRoleNameFromArn('arn:aws:iam::123456789012:user/MyUser')).toThrow('Invalid IAM Role ARN format');
    });

    it('throws BadRequestError for role ARN with missing role name', () => {
      expect(() => ArnUtil.getRoleNameFromArn('arn:aws:iam::123456789012:role/')).toThrow('Role name not found in ARN');
    });

    it('extracts role name from ARN with path prefix', () => {
      // ARN split on ':' gives 'role/path/MyRole', split on '/' gives index [1] = 'path'
      expect(ArnUtil.getRoleNameFromArn('arn:aws:iam::123456789012:role/path/MyRole')).toBe('path');
    });
  });
});
