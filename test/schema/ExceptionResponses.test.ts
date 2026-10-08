import { describe, it, expect } from 'vitest';
import {
  badRequestResponse,
  exceptionResponse,
  forbiddenResponse,
  internalServerErrorResponse,
  notFoundResponse,
  unauthorizedResponse,
} from '@aws-access-bridge/shared/schema/exceptionResponses';

/**
 * These builders replaced 147 hand-copied OpenAPI response blocks across 44
 * endpoint files. The published `/docs` spec is the contract for programmatic
 * callers, so the invariants below are asserted directly rather than left to the
 * route tests to notice incidentally.
 */
describe('exception response builders', () => {
  it('produces the {Exception: {Type, Message}} envelope every error path uses', () => {
    const response = badRequestResponse('Invalid request');
    const schema = response.content['application/json'].schema;

    expect(schema.type).toBe('object');
    expect(schema.properties.Exception.type).toBe('object');
    expect(Object.keys(schema.properties.Exception.properties).toSorted((left, right) => left.localeCompare(right))).toEqual([
      'Message',
      'Type',
    ]);
    expect(schema.properties.Exception.properties.Type.type).toBe('string');
    expect(schema.properties.Exception.properties.Message.type).toBe('string');
  });

  it('carries the caller-supplied description through', () => {
    expect(badRequestResponse('Invalid request - malformed ARN').description).toBe('Invalid request - malformed ARN');
  });

  /**
   * The type is the stable machine-readable half of the contract; the SPA matches
   * on it via `IServiceError.getErrorType()` and a caller reads it from `/docs`.
   */
  it('labels each status with the matching error type', () => {
    expect(badRequestResponse('d').content['application/json'].schema.properties.Exception.properties.Type.example).toBe('BadRequestError');
    expect(unauthorizedResponse('d').content['application/json'].schema.properties.Exception.properties.Type.example).toBe(
      'UnauthorizedError',
    );
    expect(forbiddenResponse('d').content['application/json'].schema.properties.Exception.properties.Type.example).toBe('ForbiddenError');
    expect(notFoundResponse('d').content['application/json'].schema.properties.Exception.properties.Type.example).toBe('NotFoundError');
    expect(internalServerErrorResponse('d').content['application/json'].schema.properties.Exception.properties.Type.example).toBe(
      'InternalServerError',
    );
  });

  /**
   * 401 and 403 must not collapse. `isUnauthorized` in the web layer keys on 401
   * alone, so a 403 rendered as 401 would send an administrator to the Zero Trust
   * login page for something re-authenticating cannot fix.
   */
  it('keeps 401 and 403 distinguishable', () => {
    expect(unauthorizedResponse('d').content['application/json'].schema.properties.Exception.properties.Type.example).not.toBe(
      forbiddenResponse('d').content['application/json'].schema.properties.Exception.properties.Type.example,
    );
  });

  it('accepts a caller-specific example message', () => {
    const response = badRequestResponse('d', 'Malformed principal ARN.');
    expect(response.content['application/json'].schema.properties.Exception.properties.Message.example).toBe('Malformed principal ARN.');
  });

  /**
   * `DatabaseError` embeds raw D1/SQLite text and `toErrorResponse` already
   * answers a 5xx with a generic message, so documenting a real internal message
   * would advertise a shape the server never emits.
   */
  it('documents a generic 500 message rather than an internal one', () => {
    const example =
      internalServerErrorResponse('Internal server error').content['application/json'].schema.properties.Exception.properties.Message
        .example;
    expect(example).toBe('An unexpected error occurred. Please try again later.');
    expect(example).not.toMatch(/SQLITE|D1|stack|at Object/i);
  });

  it('defaults sensibly through the generic builder', () => {
    const response = exceptionResponse('Something went wrong');
    expect(response.content['application/json'].schema.properties.Exception.properties.Type.example).toBe('BadRequestError');
    expect(response.content['application/json'].schema.properties.Exception.properties.Message.example).toBeTruthy();
  });

  it('documents the Type and Message halves, so the envelope is self-describing', () => {
    const properties = badRequestResponse('d').content['application/json'].schema.properties.Exception.properties;
    expect(properties.Type.description).toBeTruthy();
    expect(properties.Message.description).toBeTruthy();
  });
});
