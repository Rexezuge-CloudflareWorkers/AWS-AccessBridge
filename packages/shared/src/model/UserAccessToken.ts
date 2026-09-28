interface UserAccessTokenMetadata {
  tokenId: string;
  userEmail: string;
  userId?: string | null;
  name: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt?: number;
}

interface UserAccessToken extends UserAccessTokenMetadata {
  accessToken: string;
}

interface UserAccessTokenInternal {
  token_id: string;
  user_email: string;
  user_id?: string | null;
  access_token: string;
  name: string;
  created_at: number;
  expires_at: number;
  last_used_at?: number;
}

export type { UserAccessToken, UserAccessTokenMetadata, UserAccessTokenInternal };
