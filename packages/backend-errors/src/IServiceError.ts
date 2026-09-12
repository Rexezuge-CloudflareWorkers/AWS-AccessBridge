import { ContentfulStatusCode } from 'hono/utils/http-status';

abstract class IServiceError extends Error {
  public abstract getErrorCode(): ErrorCode;

  public abstract getErrorType(): string;

  public abstract getErrorMessage(): string;
}

type ErrorCode = ContentfulStatusCode;

export { IServiceError };
export type { ErrorCode };
