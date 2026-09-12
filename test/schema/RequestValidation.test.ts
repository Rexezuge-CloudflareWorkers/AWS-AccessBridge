import { describe, expect, it } from 'vitest';
import { BadRequestError } from '@aws-access-bridge/backend-errors';
import { getRequestInputSchema, validateRequestInput } from '@/schema';

describe('Request input schemas', () => {
  it('finds schemas by method and pathname', () => {
    const request = new Request('https://access-bridge.example.com/user/favorites', { method: 'POST' });

    expect(getRequestInputSchema(request)).toBeDefined();
  });

  it('returns a sanitized body for valid input', async () => {
    const request = new Request('https://access-bridge.example.com/user/favorites', { method: 'POST' });

    await expect(validateRequestInput(request, { awsAccountId: '123456789012', ignored: true })).resolves.toEqual({
      awsAccountId: '123456789012',
    });
  });

  it('rejects invalid body data', async () => {
    const request = new Request('https://access-bridge.example.com/user/favorites', { method: 'POST' });

    await expect(validateRequestInput(request, { awsAccountId: 'not-an-account' })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects invalid query data', async () => {
    const request = new Request('https://access-bridge.example.com/user/resources?limit=not-a-number', { method: 'GET' });

    await expect(validateRequestInput(request, {})).rejects.toBeInstanceOf(BadRequestError);
  });

  it('requires console role context fields to be paired', async () => {
    const request = new Request('https://access-bridge.example.com/api/aws/console', { method: 'POST' });

    await expect(
      validateRequestInput(request, {
        accessKeyId: 'ASIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secret',
        awsAccountId: '123456789012',
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('accepts role session duration seconds in role config', async () => {
    const request = new Request('https://access-bridge.example.com/user/admin/role/config', { method: 'PUT' });

    await expect(
      validateRequestInput(request, {
        awsAccountId: '123456789012',
        roleName: 'Admin',
        roleSessionDurationSeconds: 14400,
      }),
    ).resolves.toEqual({
      awsAccountId: '123456789012',
      roleName: 'Admin',
      roleSessionDurationSeconds: 14400,
    });
  });

  it('rejects out-of-range role session duration seconds', async () => {
    const request = new Request('https://access-bridge.example.com/user/admin/role/config', { method: 'PUT' });

    await expect(
      validateRequestInput(request, {
        awsAccountId: '123456789012',
        roleName: 'Admin',
        roleSessionDurationSeconds: 899,
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});
