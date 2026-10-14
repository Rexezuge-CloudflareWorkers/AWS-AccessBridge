import { describe, it, expect } from 'vitest';
import { BadRequestError, UnauthorizedError, ForbiddenError, InternalServerError } from '@rexezuge/errors';
import { toErrorResponse } from '@rexezuge/http';

interface Envelope {
  Exception: { Type: string; Message: string };
}

/**
 * The error → wire contract, asserted against the mapper that now produces it.
 *
 * These cases used to live against `backend-services`' `ErrorTranslationUtil`,
 * which threw an `HTTPException`. That file is gone: the mapper is
 * `@rexezuge/http`'s, it **returns** a `Response` so the same code works from a
 * bare-`Request` dispatcher, and it normalizes an unknown throw instead of
 * letting it escape as a framework error page. The envelope is unchanged, which
 * is why these expectations are unchanged — that is the whole point of them.
 */
async function respond(error: unknown): Promise<{ status: number; body: Envelope }> {
  const response = toErrorResponse(error, (body: unknown, status: number) => Response.json(body, { status }));
  return { status: response.status, body: (await response.json()) as Envelope };
}

describe('toErrorResponse', () => {
  it('answers a BadRequestError as 400 in the {Exception:{…}} dialect', async () => {
    expect(await respond(new BadRequestError('test bad request'))).toEqual({
      status: 400,
      body: { Exception: { Type: 'BadRequest', Message: 'test bad request' } },
    });
  });

  it('answers an UnauthorizedError as 401', async () => {
    expect((await respond(new UnauthorizedError('test unauthorized'))).status).toBe(401);
    expect((await respond(new UnauthorizedError('test unauthorized'))).body.Exception.Type).toBe('Unauthorized');
  });

  it('answers a ForbiddenError as 403', async () => {
    expect((await respond(new ForbiddenError('test forbidden'))).status).toBe(403);
    expect((await respond(new ForbiddenError('test forbidden'))).body.Exception.Type).toBe('Forbidden');
  });

  it('answers an InternalServerError as 500', async () => {
    expect((await respond(new InternalServerError('test internal'))).status).toBe(500);
    expect((await respond(new InternalServerError('test internal'))).body.Exception.Type).toBe('InternalServerError');
  });

  it('uses the catalogue default message when none was supplied', async () => {
    expect((await respond(new BadRequestError())).body.Exception.Message).toBe(
      'The request could not be understood or was missing required parameters.',
    );
  });

  it('masks the message of a 5xx, because a D1 error names tables and columns', async () => {
    // The substitution the middleware-level `instanceof ServiceError` check could
    // not make: it never saw anything that was *not* a `ServiceError`, so a raw
    // throw reached the client carrying its own text.
    const { body } = await respond(new InternalServerError('D1_ERROR: no such table: aws_accounts_secret_column'));
    expect(body.Exception.Message).not.toContain('aws_accounts_secret_column');
  });

  it('turns an unknown throw into a 500 rather than letting it escape', async () => {
    const { status, body } = await respond(new TypeError('cannot read properties of undefined'));
    expect(status).toBe(500);
    expect(body.Exception.Type).toBeTruthy();
  });
});
