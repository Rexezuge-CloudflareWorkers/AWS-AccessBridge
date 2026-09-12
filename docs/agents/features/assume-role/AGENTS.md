# Assume-Role Flows

Scope: browser + programmatic + federate fan-out. Parent index: `../../../AGENTS.md`.

Three surfaces share route classes (`apps/api/src/endpoints/api/aws/`): `POST /user/aws/assume-role` (browser, Cloudflare Access), `POST /api/aws/assume-role` (PAT or HMAC), `POST /user/aws/console` + `POST /api/aws/console` (temporary Console URLs via `ConsoleService.getSigninToken`), `GET /user/aws/federate` + `GET /api/aws/federate` (bookmark-style fan-out: resolves the chain, calls the `/api/aws/*` pair internally via `SELF` + `InternalRequestHelper` HMAC signing).

Chain resolution: `CredentialService` (over `CredentialsDAO`) builds the ordered `principalArns` (base → target); each hop calls `StsService.assumeRole` (STS, `aws4fetch`); orchestration lives in `AssumeRoleService.assumeRoleForUser`. Validation/discovery live in `CredentialService.validateCredentials` (via `StsService`) / `IamService.listRoles` (IAM `ListRoles` needs `iam:ListRoles` on the assumed role; the route degrades to manual entry otherwise).
