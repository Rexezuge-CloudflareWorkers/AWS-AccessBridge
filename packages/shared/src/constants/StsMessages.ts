/**
 * Canonical STS error messages (Layer 0, shared).
 * Previously in `backend-errors/constants/AssumeRoleUtil.ts` — a generic
 * errors package holding domain strings. Moved here so both
 * `provider-clients` (Layer 2) and `backend-services` (Layer 3) can import
 * without layer violations. `backend-errors/constants` re-exports for compat.
 */
export const ASSUME_ROLE_UTIL_ERROR_STS_CALL: string =
  'We could not sign you in due to a permissions issue. Please try again later or contact support if the problem continues.';
export const ASSUME_ROLE_UTIL_ERROR_STS_RESPONSE_PARSE: string = 'Unable to parse temporary credentials from STS AssumeRole response.';
