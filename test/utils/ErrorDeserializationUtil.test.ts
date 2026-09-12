import { describe, it, expect } from 'vitest';
import { ErrorDeserializationUtil } from '@aws-access-bridge/backend-services/error/ErrorDeserializationUtil';
import { BadRequestError, ForbiddenError, UnauthorizedError, InternalServerError, DatabaseError } from '@aws-access-bridge/backend-errors';

describe('ErrorDeserializationUtil', () => {
  describe('deserializeError', () => {
    it('deserializes BadRequest error', async () => {
      const response = new Response(JSON.stringify({ Exception: { Type: 'BadRequest', Message: 'bad input' } }), { status: 400 });
      const error = await ErrorDeserializationUtil.deserializeError(response);
      expect(error).toBeInstanceOf(BadRequestError);
      expect(error.getErrorMessage()).toBe('bad input');
    });

    it('deserializes Unauthorized error', async () => {
      const response = new Response(JSON.stringify({ Exception: { Type: 'Unauthorized', Message: 'no auth' } }), { status: 401 });
      const error = await ErrorDeserializationUtil.deserializeError(response);
      expect(error).toBeInstanceOf(UnauthorizedError);
      expect(error.getErrorMessage()).toBe('no auth');
    });

    it('deserializes Forbidden error', async () => {
      const response = new Response(JSON.stringify({ Exception: { Type: 'Forbidden', Message: 'denied' } }), { status: 403 });
      const error = await ErrorDeserializationUtil.deserializeError(response);
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.getErrorMessage()).toBe('denied');
    });

    it('deserializes DatabaseError', async () => {
      const response = new Response(JSON.stringify({ Exception: { Type: 'DatabaseError', Message: 'db fail' } }), { status: 500 });
      const error = await ErrorDeserializationUtil.deserializeError(response);
      expect(error).toBeInstanceOf(DatabaseError);
      expect(error.getErrorMessage()).toBe('db fail');
    });

    it('deserializes InternalServerError', async () => {
      const response = new Response(JSON.stringify({ Exception: { Type: 'InternalServerError', Message: 'server error' } }), {
        status: 500,
      });
      const error = await ErrorDeserializationUtil.deserializeError(response);
      expect(error).toBeInstanceOf(InternalServerError);
      expect(error.getErrorMessage()).toBe('server error');
    });

    it('defaults to InternalServerError for unknown type', async () => {
      const response = new Response(JSON.stringify({ Exception: { Type: 'SomethingElse', Message: 'unknown' } }), { status: 500 });
      const error = await ErrorDeserializationUtil.deserializeError(response);
      expect(error).toBeInstanceOf(InternalServerError);
      expect(error.getErrorMessage()).toBe('unknown');
    });

    it('defaults to InternalServerError with default message when Exception is empty', async () => {
      const response = new Response(JSON.stringify({ Exception: {} }), { status: 500 });
      const error = await ErrorDeserializationUtil.deserializeError(response);
      expect(error).toBeInstanceOf(InternalServerError);
      expect(error.getErrorMessage()).toBe('Unknown error occurred');
    });

    it('defaults to InternalServerError when response is not valid JSON', async () => {
      const response = new Response('not json', { status: 500, statusText: 'Internal Server Error' });
      const error = await ErrorDeserializationUtil.deserializeError(response);
      expect(error).toBeInstanceOf(InternalServerError);
      expect(error.getErrorMessage()).toBe('HTTP 500: Internal Server Error');
    });

    it('handles missing Exception field gracefully', async () => {
      const response = new Response(JSON.stringify({}), { status: 500 });
      const error = await ErrorDeserializationUtil.deserializeError(response);
      expect(error).toBeInstanceOf(InternalServerError);
      expect(error.getErrorMessage()).toBe('Unknown error occurred');
    });
  });
});
