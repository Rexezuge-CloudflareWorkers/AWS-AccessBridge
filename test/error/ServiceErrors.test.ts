import { describe, it, expect } from 'vitest';
import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  InternalServerError,
  DatabaseError,
  DefaultInternalServerError,
  IServiceError,
} from '@aws-access-bridge/backend-errors';

describe('Service Errors', () => {
  describe('BadRequestError', () => {
    it('has error code 400', () => {
      const error = new BadRequestError();
      expect(error.getErrorCode()).toBe(400);
    });

    it('has error type BadRequest', () => {
      const error = new BadRequestError();
      expect(error.getErrorType()).toBe('BadRequest');
    });

    it('uses default message when none provided', () => {
      const error = new BadRequestError();
      expect(error.getErrorMessage()).toBe('The request could not be understood by the server due to malformed syntax.');
    });

    it('uses custom message when provided', () => {
      const error = new BadRequestError('custom error');
      expect(error.getErrorMessage()).toBe('custom error');
    });

    it('extends IServiceError', () => {
      const error = new BadRequestError();
      expect(error).toBeInstanceOf(IServiceError);
    });

    it('extends Error', () => {
      const error = new BadRequestError('test');
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('test');
    });
  });

  describe('UnauthorizedError', () => {
    it('has error code 401', () => {
      expect(new UnauthorizedError().getErrorCode()).toBe(401);
    });

    it('has error type Unauthorized', () => {
      expect(new UnauthorizedError().getErrorType()).toBe('Unauthorized');
    });

    it('uses default message when none provided', () => {
      expect(new UnauthorizedError().getErrorMessage()).toBe('Authentication is required and has failed or has not yet been provided.');
    });

    it('uses custom message', () => {
      expect(new UnauthorizedError('denied').getErrorMessage()).toBe('denied');
    });
  });

  describe('ForbiddenError', () => {
    it('has error code 403', () => {
      expect(new ForbiddenError().getErrorCode()).toBe(403);
    });

    it('has error type Forbidden', () => {
      expect(new ForbiddenError().getErrorType()).toBe('Forbidden');
    });

    it('uses default message when none provided', () => {
      expect(new ForbiddenError().getErrorMessage()).toBe('You do not have permission to access this resource.');
    });

    it('uses custom message', () => {
      expect(new ForbiddenError('nope').getErrorMessage()).toBe('nope');
    });
  });

  describe('InternalServerError', () => {
    it('has error code 500', () => {
      expect(new InternalServerError().getErrorCode()).toBe(500);
    });

    it('has error type InternalServerError', () => {
      expect(new InternalServerError().getErrorType()).toBe('InternalServerError');
    });

    it('uses default message when none provided', () => {
      expect(new InternalServerError().getErrorMessage()).toBe(
        'The server encountered an internal error and was unable to complete your request.',
      );
    });

    it('uses custom message', () => {
      expect(new InternalServerError('crash').getErrorMessage()).toBe('crash');
    });
  });

  describe('DatabaseError', () => {
    it('has error code 500 (inherits from InternalServerError)', () => {
      expect(new DatabaseError().getErrorCode()).toBe(500);
    });

    it('has error type DatabaseError', () => {
      expect(new DatabaseError().getErrorType()).toBe('DatabaseError');
    });

    it('uses default message when none provided', () => {
      expect(new DatabaseError().getErrorMessage()).toContain('unexpected problem while accessing the database');
    });

    it('uses custom message', () => {
      expect(new DatabaseError('db down').getErrorMessage()).toBe('db down');
    });

    it('extends InternalServerError', () => {
      expect(new DatabaseError()).toBeInstanceOf(InternalServerError);
    });

    it('extends IServiceError', () => {
      expect(new DatabaseError()).toBeInstanceOf(IServiceError);
    });
  });

  describe('DefaultInternalServerError', () => {
    it('is a singleton instance of InternalServerError', () => {
      expect(DefaultInternalServerError).toBeInstanceOf(InternalServerError);
    });

    it('has the default message', () => {
      expect(DefaultInternalServerError.getErrorMessage()).toBe(
        'The server encountered an internal error and was unable to complete your request.',
      );
    });

    it('has error code 500', () => {
      expect(DefaultInternalServerError.getErrorCode()).toBe(500);
    });
  });
});
