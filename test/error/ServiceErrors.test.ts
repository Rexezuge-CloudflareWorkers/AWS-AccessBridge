import { describe, it, expect } from 'vitest';
import { BadRequestError, UnauthorizedError, ForbiddenError, InternalServerError, DatabaseError, DefaultInternalServerError, ServiceError } from '@rexezuge/errors';

describe('Service Errors', () => {
  describe('BadRequestError', () => {
    it('has error code 400', () => {
      const error = new BadRequestError();
      expect(error.status).toBe(400);
    });

    it('has error type BadRequest', () => {
      const error = new BadRequestError();
      expect(error.type).toBe('BadRequest');
    });

    it('uses default message when none provided', () => {
      const error = new BadRequestError();
      expect(error.message).toBe('The request could not be understood or was missing required parameters.');
    });

    it('uses custom message when provided', () => {
      const error = new BadRequestError('custom error');
      expect(error.message).toBe('custom error');
    });

    it('extends ServiceError', () => {
      const error = new BadRequestError();
      expect(error).toBeInstanceOf(ServiceError);
    });

    it('extends Error', () => {
      const error = new BadRequestError('test');
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('test');
    });
  });

  describe('UnauthorizedError', () => {
    it('has error code 401', () => {
      expect(new UnauthorizedError().status).toBe(401);
    });

    it('has error type Unauthorized', () => {
      expect(new UnauthorizedError().type).toBe('Unauthorized');
    });

    it('uses default message when none provided', () => {
      expect(new UnauthorizedError().message).toBe('Authentication is required and has failed or has not yet been provided.');
    });

    it('uses custom message', () => {
      expect(new UnauthorizedError('denied').message).toBe('denied');
    });
  });

  describe('ForbiddenError', () => {
    it('has error code 403', () => {
      expect(new ForbiddenError().status).toBe(403);
    });

    it('has error type Forbidden', () => {
      expect(new ForbiddenError().type).toBe('Forbidden');
    });

    it('uses default message when none provided', () => {
      expect(new ForbiddenError().message).toBe('You do not have permission to perform this action.');
    });

    it('uses custom message', () => {
      expect(new ForbiddenError('nope').message).toBe('nope');
    });
  });

  describe('InternalServerError', () => {
    it('has error code 500', () => {
      expect(new InternalServerError().status).toBe(500);
    });

    it('has error type InternalServerError', () => {
      expect(new InternalServerError().type).toBe('InternalServerError');
    });

    it('uses default message when none provided', () => {
      expect(new InternalServerError().message).toBe(
        'The server encountered an internal error and was unable to complete your request.',
      );
    });

    it('uses custom message', () => {
      expect(new InternalServerError('crash').message).toBe('crash');
    });
  });

  describe('DatabaseError', () => {
    it('has error code 500 (inherits from InternalServerError)', () => {
      expect(new DatabaseError().status).toBe(500);
    });

    it('has error type DatabaseError', () => {
      expect(new DatabaseError().type).toBe('DatabaseError');
    });

    it('uses default message when none provided', () => {
      expect(new DatabaseError().message).toContain('unexpected problem while accessing the database');
    });

    it('uses custom message', () => {
      expect(new DatabaseError('db down').message).toBe('db down');
    });

    it('extends InternalServerError', () => {
      expect(new DatabaseError()).toBeInstanceOf(InternalServerError);
    });

    it('extends ServiceError', () => {
      expect(new DatabaseError()).toBeInstanceOf(ServiceError);
    });
  });

  describe('DefaultInternalServerError', () => {
    it('is a singleton instance of InternalServerError', () => {
      expect(DefaultInternalServerError).toBeInstanceOf(InternalServerError);
    });

    it('has the default message', () => {
      expect(DefaultInternalServerError.message).toBe(
        'The server encountered an internal error and was unable to complete your request.',
      );
    });

    it('has error code 500', () => {
      expect(DefaultInternalServerError.status).toBe(500);
    });
  });
});
