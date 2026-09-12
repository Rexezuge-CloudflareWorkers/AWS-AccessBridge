# Credential Chains

Scope: encrypted credentials, multi-hop assumption, KV cache. Parent index: `../../../AGENTS.md`.

Credentials are stored AES-GCM-encrypted in D1 (`CredentialsDAO`, key from `AES_ENCRYPTION_KEY_SECRET`). A principal maps to an ordered chain (`principalArns`: base IAM user → … → target role, up to `PRINCIPAL_TRUST_CHAIN_LIMIT` hops); `test-chain` (`POST /user/admin/credentials/test-chain`) walks base→target assuming each hop. Relationships are managed via `…/credentials/relationship` (POST/DELETE); access grants via `…/admin/access`.

Hot chains are pre-assumed by `CredentialCacheRefreshTask` (phase 1) into KV (`CredentialsCacheDAO`, `credential_cache_config` tracks `last_cached_at`); TTLs in `backend-data/constants/kv/`. `AwsAccountsDAO` + `RoleConfigsDAO` hold account nicknames and per-role config (session duration, destination path).
