interface CredentialCache {
  principalArn: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: number;
}

export type { CredentialCache };
