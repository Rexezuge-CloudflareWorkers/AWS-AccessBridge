import { InternalServerError } from './InternalServerError';

/**
 * An AWS discovery call failed, so the result is *unknown* rather than empty.
 *
 * This distinction is load-bearing. A collector that swallowed a 403/429/500 and
 * returned `[]` made "we were denied" indistinguishable from "this account has
 * no resources", and any caller that treats an empty result as authoritative —
 * pruning previously collected inventory, for instance — then deletes real data
 * on the strength of a transient AWS error.
 *
 * `retryable` is carried through so a scheduler can distinguish a throttle from
 * a permanent AccessDenied without re-parsing the message.
 */
class AwsCollectionError extends InternalServerError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly resourceType: string,
  ) {
    super(message);
    this.retryable = status === 429 || status >= 500;
  }

  public getErrorType(): string {
    return 'AwsCollectionError';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { AwsCollectionError };