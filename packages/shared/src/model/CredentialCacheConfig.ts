interface CredentialCacheConfig {
  principalArn: string;
  lastCachedAt: number;
}

interface CredentialCacheConfigInternal {
  principal_arn: string;
  last_cached_at: number;
}

export type { CredentialCacheConfig, CredentialCacheConfigInternal };
