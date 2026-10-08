import { describe, expect, it } from 'vitest';
import { ConflictError, IServiceError, NotFoundError } from '@aws-access-bridge/backend-errors';
import { ErrorDeserializationUtil } from '@aws-access-bridge/backend-services/error/ErrorDeserializationUtil';
import { ErrorTranslationUtil } from '@aws-access-bridge/backend-services/error/ErrorTranslationUtil';

describe('NotFoundError', () => {
  it('is a 404 that is not retryable and extends the taxonomy', () => {
    const error = new NotFoundError();
    expect(error.getErrorCode()).toBe(404);
    expect(error.getErrorType()).toBe('NotFound');
    expect(error.retryable).toBe(false);
    expect(error).toBeInstanceOf(IServiceError);
    expect(error).toBeInstanceOf(Error);
  });

  it('keeps a custom message and falls back to a default', () => {
    expect(new NotFoundError('no such team').getErrorMessage()).toBe('no such team');
    expect(new NotFoundError().getErrorMessage()).toBe('The requested resource was not found.');
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
    expect(error.getErrorMessage()).toBe('m');
  });
});
