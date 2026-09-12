export function buildPrincipalArn(accountId: string, roleName: string): string {
  return `arn:aws:iam::${accountId}:role/${roleName}`;
}

export function exportEnv(accessKeyId: string, secretAccessKey: string, sessionToken: string): string {
  return `export AWS_ACCESS_KEY_ID="${accessKeyId}"
export AWS_SECRET_ACCESS_KEY="${secretAccessKey}"
export AWS_SESSION_TOKEN="${sessionToken}"`.trim();
}
