import { describe, it, expect } from 'vitest';
import { ErrorTranslationUtil } from '@aws-access-bridge/backend-services/error/ErrorTranslationUtil';
import { BadRequestError, UnauthorizedError, ForbiddenError, InternalServerError } from '@aws-access-bridge/backend-errors';
import { HTTPException } from 'hono/http-exception';

describe('ErrorTranslationUtil', () => {
  describe('toHTTPException', () => {
    it('converts BadRequestError to HTTPException with status 400', () => {
      const error = new BadRequestError('test bad request');
      const exception: HTTPException = ErrorTranslationUtil.toHTTPException(error);
      expect(exception).toBeInstanceOf(HTTPException);
      expect(exception.status).toBe(400);
      const parsed = JSON.parse(exception.message);
      expect(parsed.Exception.Type).toBe('BadRequest');
      expect(parsed.Exception.Message).toBe('test bad request');
    });

    it('converts UnauthorizedError to HTTPException with status 401', () => {
      const error = new UnauthorizedError('test unauthorized');
      const exception: HTTPException = ErrorTranslationUtil.toHTTPException(error);
      expect(exception.status).toBe(401);
      const parsed = JSON.parse(exception.message);
      expect(parsed.Exception.Type).toBe('Unauthorized');
    });

    it('converts ForbiddenError to HTTPException with status 403', () => {
      const error = new ForbiddenError('test forbidden');
      const exception: HTTPException = ErrorTranslationUtil.toHTTPException(error);
      expect(exception.status).toBe(403);
      const parsed = JSON.parse(exception.message);
      expect(parsed.Exception.Type).toBe('Forbidden');
    });

    it('converts InternalServerError to HTTPException with status 500', () => {
      const error = new InternalServerError('test internal');
      const exception: HTTPException = ErrorTranslationUtil.toHTTPException(error);
      expect(exception.status).toBe(500);
      const parsed = JSON.parse(exception.message);
      expect(parsed.Exception.Type).toBe('InternalServerError');
    });

    it('uses default error message when none provided', () => {
      const error = new BadRequestError();
      const exception: HTTPException = ErrorTranslationUtil.toHTTPException(error);
      const parsed = JSON.parse(exception.message);
      expect(parsed.Exception.Message).toBe('The request could not be understood by the server due to malformed syntax.');
    });
  });
});
