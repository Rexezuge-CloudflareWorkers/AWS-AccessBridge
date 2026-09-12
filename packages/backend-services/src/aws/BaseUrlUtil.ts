import { INTERNAL_BASE_URL_HEADER, SELF_WORKER_BASE_HOSTNAME } from '@aws-access-bridge/shared/constants';
import { InternalServerError } from '@aws-access-bridge/backend-errors';
import { RequestOriginUtil } from '@aws-access-bridge/shared/utils';

const BaseUrlUtil = {
  getBaseUrl(request: Request, env?: unknown): string {
    const url: URL = new URL(request.url);
    if (url.hostname === SELF_WORKER_BASE_HOSTNAME) {
      const internalBaseUrl: string | null = request.headers.get(INTERNAL_BASE_URL_HEADER);
      if (internalBaseUrl) {
        return internalBaseUrl;
      }
      throw new InternalServerError('Internal call missing required base URL header.');
    }
    const trustedForwardedOrigin: string | undefined = RequestOriginUtil.getTrustedForwardedOrigin(request, env);
    if (trustedForwardedOrigin) {
      return trustedForwardedOrigin;
    }
    return url.origin;
  },
};

export { BaseUrlUtil };
