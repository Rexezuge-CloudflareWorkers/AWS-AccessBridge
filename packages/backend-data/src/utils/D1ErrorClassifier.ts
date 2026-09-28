const RETRYABLE_PATTERNS: RegExp[] = [
  /busy/i,
  /locked/i,
  /timeout/i,
  /timed?\s*out/i,
  /internal\s+(server\s+)?error/i,
  /connection/i,
  /network/i,
  /unavailable/i,
  /throttl/i,
  /too\s+many/i,
  /retry/i,
  /deadlock/i,
  /serialization/i,
];

const NON_RETRYABLE_PATTERNS: RegExp[] = [
  /constraint/i,
  /unique/i,
  /primary\s+key/i,
  /foreign\s+key/i,
  /not\s+found/i,
  /syntax/i,
  /parse\s+error/i,
  /no\s+such\s+(table|column|index)/i,
  /type\s+mismatch/i,
  /range/i,
  /permission/i,
  /authorization/i,
  /authentication/i,
  /invalid\s+argument/i,
];

function isD1ErrorRetryable(errorMessage: string): boolean {
  if (!errorMessage) return false;

  for (const pattern of NON_RETRYABLE_PATTERNS) {
    if (pattern.test(errorMessage)) return false;
  }

  for (const pattern of RETRYABLE_PATTERNS) {
    if (pattern.test(errorMessage)) return true;
  }

  return false;
}

const MISSING_SCHEMA_PATTERNS: RegExp[] = [/no such table/i, /no such column/i, /has no column named/i, /does not exist/i];

/**
 * Whether an error is a *missing schema* failure rather than a genuine fault.
 *
 * The distinction matters wherever a read has a pre- and post-migration shape: a
 * database that has not applied a migration raises "no such table", and the
 * caller must degrade to its legacy path rather than treat it as an outage and
 * fail the request. Anything else — a constraint violation, a timeout — keeps
 * propagating, so an outage can never be mistaken for legacy data.
 */
function isMissingSchemaError(error: unknown): boolean {
  const message: string = error instanceof Error ? error.message : String(error);
  return message ? MISSING_SCHEMA_PATTERNS.some((pattern) => pattern.test(message)) : false;
}

export { isD1ErrorRetryable, isMissingSchemaError };
