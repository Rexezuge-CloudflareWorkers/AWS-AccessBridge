interface Credential {
  principalArn: string;
  assumedBy?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

interface CredentialInternal {
  principal_arn: string;
  assumed_by?: string;
  encrypted_access_key_id?: string;
  encrypted_secret_access_key?: string;
  encrypted_session_token?: string;
  salt?: string;
}

export type { Credential, CredentialInternal };
