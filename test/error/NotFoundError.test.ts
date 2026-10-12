import { describe, expect, it } from 'vitest';
import { ConflictError, ServiceError, NotFoundError } from '@rexezuge/errors';
import { ErrorDeserializationUtil } from '@aws-access-bridge/backend-services/error/ErrorDeserializationUtil';
import { ErrorTranslationUtil } from '@aws-access-bridge/backend-services/error/ErrorTranslationUtil';

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

  it('translates to a 404 HTTPException through the generic mapping', () => {
    const exception = ErrorTranslationUtil.toHTTPException(new NotFoundError('no such team'));
    expect(exception.status).toBe(404);
    expect(JSON.parse(exception.message)).toEqual({ Exception: { Type: 'NotFound', Message: 'no such team' } });
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
