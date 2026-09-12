interface AccessKeys {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

interface AccessKeysWithExpiration extends AccessKeys {
  expiration?: string;
}

export type { AccessKeys, AccessKeysWithExpiration };
