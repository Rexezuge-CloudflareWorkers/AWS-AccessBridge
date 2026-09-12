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

export { isD1ErrorRetryable };
