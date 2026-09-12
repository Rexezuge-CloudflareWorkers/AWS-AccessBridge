import { AbstractEntrypointWorker } from '@aws-access-bridge/backend-runtime/base';
import { fromHono, HonoOpenAPIRouterType } from 'chanfana';
import { Hono } from 'hono';
import {
  FavoriteAccountRoute,
  UnfavoriteAccountRoute,
  StoreCredentialRoute,
  GenerateConsoleUrlRoute,
  AssumeRoleRoute,
  FederateRoute,
  ListAssumablesRoute,
  SearchAccountsRoute,
  GetCurrentUserRoute,
  UpdateCurrentUserRoute,
  GrantAccessRoute,
  RevokeAccessRoute,
  SetAccountNicknameRoute,
  RemoveAccountNicknameRoute,
  StoreCredentialRelationshipRoute,
  RemoveCredentialRelationshipRoute,
  HideRoleRoute,
  UnhideRoleRoute,
  SetRoleConfigRoute,
  DeleteRoleConfigRoute,
  CreateTokenRoute,
  ListTokensRoute,
  DeleteTokenRoute,
  ValidateCredentialsRoute,
  TestCredentialChainRoute,
  ListAccountRolesRoute,
  ListAuditLogsRoute,
  GetCostSummaryRoute,
  GetAccountCostRoute,
  GetCostTrendsRoute,
  CreateSpendAlertRoute,
  DeleteSpendAlertRoute,
  EnableDataCollectionRoute,
  DisableDataCollectionRoute,
  ListResourcesRoute,
  GetResourceSummaryRoute,
  CreateTeamRoute,
  DeleteTeamRoute,
  ListTeamsRoute,
  UpdateTeamNameRoute,
  AddTeamMemberRoute,
  RemoveTeamMemberRoute,
  ListTeamMembersRoute,
  UpdateTeamMemberRoleRoute,
  AddTeamAccountRoute,
  RemoveTeamAccountRoute,
  ListTeamAccountsRoute,
  CleanupOrphanedDataRoute,
  ListTaskRunsRoute,
} from '@/endpoints';
import { MiddlewareHandlers } from '@/middleware';
import { SPA_HTML } from '@/generated/spa-shell';
import { DEFAULT_SERVE_SPA_FROM_WORKER } from '@aws-access-bridge/backend-runtime/config';
import { DURABLE_OBJECT_NAMESPACE_GLOBAL, DURABLE_OBJECT_CRON_TASKS_RUN_URL } from '@aws-access-bridge/backend-runtime/constants/do';

type AppRouter = HonoOpenAPIRouterType<{
  Bindings: Env;
  Variables: { AuthenticatedUserEmailAddress: string };
}>;

class AccessBridgeWorker extends AbstractEntrypointWorker {
  protected readonly app: AppRouter;

  constructor() {
    super();

    const app: Hono<{
      Bindings: Env;
      Variables: { AuthenticatedUserEmailAddress: string };
    }> = new Hono<{
      Bindings: Env;
      Variables: { AuthenticatedUserEmailAddress: string };
    }>();

    // Middleware Handlers
    // Cloudflare Access protects the human surface (/user/*) only.
    // The programmatic surface (/api/*) authenticates via Bearer PAT
    // (or HMAC-signed internal SELF calls) and must stay outside Access.
    app.use('*', MiddlewareHandlers.hmacValidation());
    app.use('/user/*', MiddlewareHandlers.activityAudit());
    app.use('/api/*', MiddlewareHandlers.activityAudit());
    app.use('/user/*', MiddlewareHandlers.userAuthentication());
    app.use('/api/*', MiddlewareHandlers.apiAuthentication());

    const openapi: AppRouter = fromHono(app, {
      docs_url: '/docs',
    });

    this.registerUserRoutes(openapi);
    this.registerApiRoutes(openapi);

    // SPA catch-all: serve embedded index.html for frontend page routes only.
    // API surfaces (/user/* JSON, /api/* JSON) must never fall through to HTML.
    app.get('*', (c) => {
      const env = c.env as Env & { SERVE_SPA_FROM_WORKER?: string };
      const serveSpaFromWorker: boolean = (env.SERVE_SPA_FROM_WORKER || DEFAULT_SERVE_SPA_FROM_WORKER) === 'true';
      if (!serveSpaFromWorker) {
        return c.notFound();
      }
      const path: string = new URL(c.req.url).pathname;
      if (
        path === '/docs' ||
        path === '/redocs' ||
        path.startsWith('/user/') ||
        path.startsWith('/api/') ||
        path.startsWith('/openapi.') ||
        /\.\w+$/.test(path)
      ) {
        return c.notFound();
      }
      return c.html(SPA_HTML);
    });

    this.app = openapi;
  }

  private registerUserRoutes(openapi: AppRouter): void {
    // AWS operations (browser flows, Cloudflare Access)
    openapi.post('/user/aws/console', GenerateConsoleUrlRoute);
    openapi.post('/user/aws/assume-role', AssumeRoleRoute);
    openapi.get('/user/aws/federate', FederateRoute);

    // User operations
    openapi.get('/user/assumables', ListAssumablesRoute);
    openapi.get('/user/assumables/search', SearchAccountsRoute);
    openapi.get('/user/me', GetCurrentUserRoute);
    openapi.put('/user/me', UpdateCurrentUserRoute);
    openapi.post('/user/favorites', FavoriteAccountRoute);
    openapi.delete('/user/favorites', UnfavoriteAccountRoute);
    openapi.post('/user/assumable/hidden', HideRoleRoute);
    openapi.delete('/user/assumable/hidden', UnhideRoleRoute);
    openapi.post('/user/tokens', CreateTokenRoute);
    openapi.delete('/user/tokens', DeleteTokenRoute);
    openapi.get('/user/tokens', ListTokensRoute);

    // Admin operations
    openapi.post('/user/admin/credentials', StoreCredentialRoute);
    openapi.post('/user/admin/credentials/relationship', StoreCredentialRelationshipRoute);
    openapi.delete('/user/admin/credentials/relationship', RemoveCredentialRelationshipRoute);
    openapi.post('/user/admin/access', GrantAccessRoute);
    openapi.delete('/user/admin/access', RevokeAccessRoute);
    openapi.put('/user/admin/account/nickname', SetAccountNicknameRoute);
    openapi.delete('/user/admin/account/nickname', RemoveAccountNicknameRoute);
    openapi.put('/user/admin/role/config', SetRoleConfigRoute);
    openapi.delete('/user/admin/role/config', DeleteRoleConfigRoute);
    openapi.post('/user/admin/credentials/validate', ValidateCredentialsRoute);
    openapi.post('/user/admin/credentials/test-chain', TestCredentialChainRoute);
    openapi.post('/user/admin/account/roles', ListAccountRolesRoute);
    openapi.get('/user/admin/audit-logs', ListAuditLogsRoute);

    // Cost operations
    openapi.get('/user/costs/summary', GetCostSummaryRoute);
    openapi.get('/user/costs/account', GetAccountCostRoute);
    openapi.get('/user/costs/trends', GetCostTrendsRoute);
    openapi.post('/user/admin/costs/alerts', CreateSpendAlertRoute);
    openapi.delete('/user/admin/costs/alerts', DeleteSpendAlertRoute);
    openapi.post('/user/admin/collection/config', EnableDataCollectionRoute);
    openapi.delete('/user/admin/collection/config', DisableDataCollectionRoute);

    // Resource operations
    openapi.get('/user/resources', ListResourcesRoute);
    openapi.get('/user/resources/summary', GetResourceSummaryRoute);

    // Team operations
    openapi.post('/user/admin/team', CreateTeamRoute);
    openapi.delete('/user/admin/team', DeleteTeamRoute);
    openapi.get('/user/admin/teams', ListTeamsRoute);
    openapi.put('/user/admin/team/name', UpdateTeamNameRoute);
    openapi.post('/user/admin/team/member', AddTeamMemberRoute);
    openapi.delete('/user/admin/team/member', RemoveTeamMemberRoute);
    openapi.get('/user/admin/team/members', ListTeamMembersRoute);
    openapi.put('/user/admin/team/member/role', UpdateTeamMemberRoleRoute);
    openapi.post('/user/admin/team/account', AddTeamAccountRoute);
    openapi.delete('/user/admin/team/account', RemoveTeamAccountRoute);
    openapi.get('/user/admin/team/accounts', ListTeamAccountsRoute);

    // Maintenance operations
    openapi.post('/user/admin/maintenance/cleanup-orphaned', CleanupOrphanedDataRoute);
    openapi.get('/user/admin/maintenance/task-runs', ListTaskRunsRoute);
  }

  private registerApiRoutes(openapi: AppRouter): void {
    // Programmatic API (Bearer PAT or HMAC-signed internal calls, never Cloudflare Access).
    // Federate internally fans out to these two endpoints via SELF + HMAC.
    openapi.post('/api/aws/console', GenerateConsoleUrlRoute);
    openapi.post('/api/aws/assume-role', AssumeRoleRoute);
    openapi.get('/api/aws/federate', FederateRoute);
  }

  protected async onRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return this.app.fetch(request, env, ctx);
  }

  protected onScheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const cronTasksId: DurableObjectId = env.CRON_TASKS.idFromName(DURABLE_OBJECT_NAMESPACE_GLOBAL);
    const cronTasksStub = env.CRON_TASKS.get(cronTasksId);
    const cronTasksRequest: Request = new Request(DURABLE_OBJECT_CRON_TASKS_RUN_URL, {
      method: 'POST',
      body: JSON.stringify({
        cron: event.cron,
        scheduledTime: event.scheduledTime,
      }),
    });

    ctx.waitUntil(
      cronTasksStub
        .fetch(cronTasksRequest)
        .then(async (response: Response): Promise<void> => {
          if (!response.ok && response.status !== 202) {
            console.error('CronTasksWorker returned an error response:', response.status, await response.text());
          }
        })
        .catch((err: unknown): void => {
          console.error('Failed to invoke CronTasksWorker:', err);
        }),
    );
    return Promise.resolve();
  }
}

export { AccessBridgeWorker };
