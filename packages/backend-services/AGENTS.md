# AWS-AccessBridge — Backend Services (Business Logic)

Scope: `packages/backend-services/**`. Parent index: `../../AGENTS.md`. Feature details: `../../docs/agents/features/*/AGENTS.md`.

Business logic by domain: `aws/` (`AwsApiUtil` — Cost Explorer, EC2/S3/Lambda/RDS/DynamoDB discovery, STS validate, IAM role discovery; `AwsConsoleUtil` — signin tokens; `AssumeRoleUtil` — STS assume-role chain hop; `ArnUtil` — ARN parse/build; `BaseUrlUtil` — origin-aware base URLs; `InternalRequestHelper` — HMAC-signed SELF calls), `auth/` (`EmailValidationUtil` — Cloudflare Access JWT verify; `TokenAuthUtil` — PAT auth), `error/` (`ErrorTranslationUtil` — service errors → Hono HTTPException; `ErrorDeserializationUtil`), `audit/` (`AuditActions` — method+path → semantic action names).

Related packages: `shared/` (constants, models, schemas, utils `TimestampUtil`, `UUIDUtil`, `RequestOriginUtil`, `EmailUtil`; `i18n/` with `BackendStrings` + `formatBackendString`, `getBackendStrings`), `backend-errors/` (`BadRequestError`, `UnauthorizedError`, `ForbiddenError`, `MethodNotAllowedError`, `InternalServerError`, `DatabaseError`, `IServiceError`, message constants), `backend-runtime/` (env `ConfigurationDefaults`, `Configurations`; abstract worker bases `AbstractEntrypointWorker`, `AbstractDurableObjectWorker`; DO naming constants; checked-in `env.d.ts` binding source of truth).
