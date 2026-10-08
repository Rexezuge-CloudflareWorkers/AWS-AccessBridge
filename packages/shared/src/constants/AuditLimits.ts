/**
 * Caps on what the audit event stores from the request line and headers
 * (Layer 0, shared). A path or User-Agent is operator-controlled input —
 * an unbounded one would let anyone bloat the security event table.
 */
export const AUDIT_MAX_PATH_LENGTH: number = 256;
export const AUDIT_MAX_USER_AGENT_LENGTH: number = 256;
