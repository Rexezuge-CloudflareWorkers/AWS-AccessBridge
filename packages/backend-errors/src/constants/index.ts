// Backwards-compatibility copies (maximal refactor).
// Canonical locations: `@aws-access-bridge/shared/constants`
// (`StsMessages.ts`, `HmacMessages.ts`). Duplicated (not re-exported)
// because Layer 0 `backend-errors` must not import any
// `@aws-access-bridge/*` package (ESLint `no-restricted-imports`).
// New code imports from `@aws-access-bridge/shared/constants`.
export const ASSUME_ROLE_UTIL_ERROR_STS_CALL: string =
  'We could not sign you in due to a permissions issue. Please try again later or contact support if the problem continues.';
export const ASSUME_ROLE_UTIL_ERROR_STS_RESPONSE_PARSE: string = 'Unable to parse temporary credentials from STS AssumeRole response.';
export const HMAC_HANDLER_ERROR_MISSING_AUTHENTICATION_HEADERS: string = 'Missing internal authentication headers';
export const HMAC_HANDLER_ERROR_REQUEST_OUTSIDE_TIME_WINDOW: string = 'Request timestamp outside valid time window';
export const HMAC_HANDLER_ERROR_SIGNATURE_INVALID: string = 'Internal request signature invalid';
