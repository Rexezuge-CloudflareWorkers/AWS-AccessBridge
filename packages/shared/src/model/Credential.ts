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
  /**
  IV for `encrypted_access_key_id`.
  */
  salt?: string;
  /**
   * IV for `encrypted_secret_access_key`. Absent on rows written before the
   * distinct-IV migration; those rows reused `salt` for every field, so reads
   * fall back to it. See `CredentialsDAO.resolveIv`.
   */
  salt_secret_access_key?: string;
  /**
  IV for `encrypted_session_token`. Same fallback semantics as above.
  */
  salt_session_token?: string;
}

export type { Credential, CredentialInternal };
