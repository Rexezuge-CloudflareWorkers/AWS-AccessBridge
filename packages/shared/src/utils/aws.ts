export function buildPrincipalArn(accountId: string, roleName: string): string {
  return `arn:aws:iam::${accountId}:role/${roleName}`;
}

/**
 * The canonical AWS account-id pattern and its user-facing message.
 *
 * Deliberately zod-free and in `utils` rather than in `schema/common`, so the web
 * app can validate an account id without pulling the validation library into the
 * browser bundle — `schema/common` wraps these in a `z.string().regex(...)`, and
 * importing that from a component would drag zod along.
 */
const AWS_ACCOUNT_ID_PATTERN: RegExp = /^\d{12}$/;
const AWS_ACCOUNT_ID_ERROR_MESSAGE = 'AWS Account ID must be exactly 12 digits.';

/**
 * Whether `value` is a syntactically valid AWS account id.
 *
 * This and `AWS_ACCOUNT_ID_PATTERN` were previously four separate spellings: a
 * regex in `schema/common`, a second regex exported from `AccessService` and
 * consumed by `AccountService`, and inline literals in the onboarding hook and
 * `AccountStep` — each with its own copy of the message, two of them worded
 * differently. Tightening the server-side rule would have left the UI accepting
 * input the API rejects, and a user would only find out from a 400.
 */
const isAwsAccountId = (value: string): boolean => AWS_ACCOUNT_ID_PATTERN.test(value);

export { AWS_ACCOUNT_ID_PATTERN, AWS_ACCOUNT_ID_ERROR_MESSAGE, isAwsAccountId };
