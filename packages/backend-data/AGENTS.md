# AWS-AccessBridge — Backend Data (D1/DAO Layer)

Scope: `packages/backend-data/**`. Parent index: `../../AGENTS.md`.

All D1 access via DAOs: `CredentialsDAO` (+ `EnhancedCredentialsDAO` chain resolution facade), `AssumableRolesDAO`, `AwsAccountsDAO`, `RoleConfigsDAO`, `UserMetadataDAO`, `UserFavoriteAccountsDAO`, `UserAccessTokenDAO`, `AuditLogDAO`, `CostDataDAO`, `DataCollectionConfigDAO`, `SpendAlertDAO`, `ResourceInventoryDAO`, `CredentialCacheConfigDAO`, `CredentialsCacheDAO` (KV), `BackgroundTaskRunDAO`, `TeamsDAO`, `TeamMembersDAO`, `TeamAccountsDAO`; `IKeyValueDAO` KV contract; `crypto/` (`aes-gcm`, `hmac` for AES-GCM credential encryption + internal HMAC signing); `constants/` (`kv/` namespaces/TTL/value-type, `d1/` session constraints).

Conventions: constructor takes `D1Database | D1DatabaseSession`; failed writes throw `DatabaseError` on `!result.success`; batch deletes expose `deleteOlderThanBatch(cutoff, batchSize): Promise<number>` (D1 `DELETE … LIMIT ?`, `meta.changes ?? 0`) for `AbstractPruningTask`; models use dual camelCase/snake_case `Type`/`TypeInternal` pairs from `@aws-access-bridge/shared/model`.
