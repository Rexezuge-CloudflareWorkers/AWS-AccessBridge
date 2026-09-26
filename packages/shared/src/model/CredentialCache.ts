interface CredentialCache {
  principalArn: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Optional because the read path tolerates an entry that has no session token
   * (it cannot be treated as corrupt, unlike a present-but-unreadable field).
   * Matches `AccessKeys.sessionToken`. Entries are written from assumed-role
   * credentials, which in practice always carry one.
   */
  sessionToken?: string;
  expiresAt: number;
}

export type { CredentialCache };
