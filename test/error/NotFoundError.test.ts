import { describe, expect, it } from 'vitest';
import { ConflictError, ServiceError, NotFoundError } from '@rexezuge/errors';
import { ErrorDeserializationUtil } from '@aws-access-bridge/backend-services/error/ErrorDeserializationUtil';
import { toErrorResponse } from '@rexezuge/http';

describe('NotFoundError', () => {
  it('is a 404 that is not retryable and extends the taxonomy', () => {
    const error = new NotFoundError();
    expect(error.status).toBe(404);
    expect(error.type).toBe('NotFound');
    expect(error.retryable).toBe(false);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toBeInstanceOf(Error);
  });

  it('keeps a custom message and falls back to a default', () => {
    expect(new NotFoundError('no such team').message).toBe('no such team');
    expect(new NotFoundError().message).toBe('The requested resource was not found.');
  });

  it('answers 404 through the shared mapper', async () => {
    const response = toErrorResponse(new NotFoundError('no such team'), (body: unknown, status: number) => Response.json(body, { status }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ Exception: { Type: 'NotFound', Message: 'no such team' } });
  });

  it.each([
    ['NotFound', NotFoundError],
    ['Conflict', ConflictError],
  ])('round-trips %s through deserialization instead of degrading to a 500', async (type, ErrorClass) => {
    const response = Response.json({ Exception: { Type: type, Message: 'm' } }, { status: 500 });
    const error = await ErrorDeserializationUtil.deserializeError(response);
    expect(error).toBeInstanceOf(ErrorClass);
    expect(error.message).toBe('m');
  });
});
