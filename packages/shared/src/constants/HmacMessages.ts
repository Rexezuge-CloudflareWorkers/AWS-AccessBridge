/**
 * Canonical HMAC error messages (Layer 0, shared).
 * Previously in `backend-errors/constants/HMACHandler.ts`. Moved here so
 * `apps/api` middleware owns semantics without importing a generic errors
 * package for domain strings. `backend-errors/constants` re-exports for compat.
 */
export const HMAC_HANDLER_ERROR_MISSING_AUTHENTICATION_HEADERS: string = 'Missing internal authentication headers';
export const HMAC_HANDLER_ERROR_REQUEST_OUTSIDE_TIME_WINDOW: string = 'Request timestamp outside valid time window';
export const HMAC_HANDLER_ERROR_SIGNATURE_INVALID: string = 'Internal request signature invalid';
