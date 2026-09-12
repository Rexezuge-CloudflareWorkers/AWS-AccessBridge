import { z } from 'zod';
import { BadRequestError } from '@aws-access-bridge/backend-errors';
import { RequestInputSchemas } from './input';
import type { RequestInputSchema } from './input';

const getRouteKey = (request: Request): string => {
  const url: URL = new URL(request.url);
  const pathname: string = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
  return `${request.method.toUpperCase()} ${pathname}`;
};

const getQueryData = (request: Request): Record<string, string> => {
  const query: Record<string, string> = {};
  new URL(request.url).searchParams.forEach((value: string, key: string): void => {
    query[key] = value;
  });
  return query;
};

const formatValidationError = (scope: string, error: z.ZodError): string => {
  const issue = error.issues[0];
  if (!issue) return `Invalid request ${scope}.`;

  const path: string = issue.path.length > 0 ? issue.path.join('.') : scope;
  return `Invalid request ${scope}: ${path}: ${issue.message}`;
};

const getRequestInputSchema = (request: Request): RequestInputSchema | undefined => {
  return (RequestInputSchemas as Record<string, RequestInputSchema>)[getRouteKey(request)];
};

const validateRequestInput = async (request: Request, body: unknown): Promise<unknown> => {
  const schema: RequestInputSchema | undefined = getRequestInputSchema(request);
  if (!schema) return body;

  if (schema.query) {
    const queryResult = await schema.query.safeParseAsync(getQueryData(request));
    if (!queryResult.success) {
      throw new BadRequestError(formatValidationError('query', queryResult.error));
    }
  }

  if (!schema.body) return body;

  const bodyResult = await schema.body.safeParseAsync(body);
  if (!bodyResult.success) {
    throw new BadRequestError(formatValidationError('body', bodyResult.error));
  }

  return bodyResult.data;
};

export { getRequestInputSchema, validateRequestInput };
export * from './common';
export * from './input';
export * from './output';
