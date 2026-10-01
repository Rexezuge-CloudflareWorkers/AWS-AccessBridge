import { IActivityAPIRoute } from './IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse, ExtendedResponse } from './IActivityAPIRoute';

import { ForbiddenError, MethodNotAllowedError } from '@aws-access-bridge/backend-errors';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

abstract class IAdminActivityAPIRoute<
  TRequest extends IRequest,
  TResponse extends IResponse,
  TEnv extends IAdminEnv,
> extends IActivityAPIRoute<TRequest, TResponse, TEnv> {
  protected async handleRequest(
    request: TRequest,
    env: TEnv,
    cxt: ActivityContext<TEnv>,
  ): Promise<TResponse | ExtendedResponse<TResponse>> {
    if (this.isDemoMode(cxt)) {
      throw new MethodNotAllowedError('Admin operations are disabled in demo mode.');
    }
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const isSuperAdmin: boolean = await getRequestScope(env).get(Tokens.UserService).isSuperAdmin(userEmail);
    if (!isSuperAdmin) {
      // 403, not 401: the caller *is* authenticated — Cloudflare Access already
      // established who they are — they simply lack the role. 401 would tell them
      // to sign in again, which cannot help, and every `/user/admin/*` OpenAPI
      // document already declares `'403'`.
      throw new ForbiddenError(
        'Your account does not have permission to perform this action. Please contact an administrator if you believe this is an error.',
      );
    }
    return this.handleAdminRequest(request, env, cxt);
  }

  protected abstract handleAdminRequest(
    request: TRequest,
    env: TEnv,
    cxt: ActivityContext<TEnv>,
  ): Promise<TResponse | ExtendedResponse<TResponse>>;
}

type IAdminEnv = IEnv;

export { IAdminActivityAPIRoute };
export type { IAdminEnv };

export { type ActivityContext, type IRequest, type IResponse, type ExtendedResponse } from './IActivityAPIRoute';
