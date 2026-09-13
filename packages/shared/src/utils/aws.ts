export function buildPrincipalArn(accountId: string, roleName: string): string {
  return `arn:aws:iam::${accountId}:role/${roleName}`;
}

/**
 * @deprecated Presentation leak — canonical home is
 * `apps/web/src/lib/shellExport.ts` (`formatShellExport`). Kept for
 * backwards compatibility (unit tests + external importers).
 */
export function exportEnv(accessKeyId: string, secretAccessKey: string, sessionToken: string): string {
  return `export AWS_ACCESS_KEY_ID="${accessKeyId}"
export AWS_SECRET_ACCESS_KEY="${secretAccessKey}"
export AWS_SESSION_TOKEN="${sessionToken}"`.trim();
}
