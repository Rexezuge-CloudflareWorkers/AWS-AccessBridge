export interface AccessKeysResponse {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
}

export type AssumablesResponse = Record<string, string[]>;
