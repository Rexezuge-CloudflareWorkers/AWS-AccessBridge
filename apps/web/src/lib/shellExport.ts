/**
 * Shell export formatting (presentation).
 *
 * This was a presentation concern living in `@aws-access-bridge/shared/utils/aws.ts`
 * as `exportEnv`, where it had no production caller and leaked into the shared
 * domain layer. It is now here, where the only consumer is, and
 * `AccessKeyModal` renders the same string it hands the clipboard so the
 * displayed and copied snippets cannot drift.
 */
function formatShellExport(accessKeyId: string, secretAccessKey: string, sessionToken?: string): string {
  const lines = [`export AWS_ACCESS_KEY_ID="${accessKeyId}"`, `export AWS_SECRET_ACCESS_KEY="${secretAccessKey}"`];
  if (sessionToken) {
    lines.push(`export AWS_SESSION_TOKEN="${sessionToken}"`);
  }
  return lines.join('\n');
}

export { formatShellExport };
