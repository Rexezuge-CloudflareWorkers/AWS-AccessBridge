import { ServiceError } from '@rexezuge/errors';

/**
 * An AWS discovery call failed, so the result is unknown rather than empty.
 *
 * Keep this error in the AWS domain: consumers of the shared SDK taxonomy do
 * not need to import an AWS-specific type. The upstream status only determines
 * retryability; the public response remains a 500, as it did before migration.
 */
class AwsCollectionError extends ServiceError {
  public readonly resourceType: string;
  public readonly upstreamStatus: number;

  constructor(message: string, upstreamStatus: number, resourceType: string) {
    super(500, 'AwsCollectionError', message, { retryable: upstreamStatus === 429 || upstreamStatus >= 500 });
    this.resourceType = resourceType;
    this.upstreamStatus = upstreamStatus;
  }
}

export { AwsCollectionError };
