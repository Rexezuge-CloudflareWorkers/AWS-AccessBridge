/**
 * Shell export formatting (presentation). Canonical home for the
 * `export AWS_*=...` snippet previously in
 * `@aws-access-bridge/shared/utils/aws.ts` (`exportEnv` — a presentation
 * leak into the shared domain layer). That function now delegates here
 * in spirit; kept as a deprecated re-export for compat. Web components
 * import from here.
 */
function formatShellExport(accessKeyId: string, secretAccessKey: string, sessionToken?: string): string {
  const lines = [`export AWS_ACCESS_KEY_ID="${accessKeyId}"`, `export AWS_SECRET_ACCESS_KEY="${secretAccessKey}"`];
  if (sessionToken) {
    lines.push(`export AWS_SESSION_TOKEN="${sessionToken}"`);
  }
  return lines.join('\n');
}

export { formatShellExport };
