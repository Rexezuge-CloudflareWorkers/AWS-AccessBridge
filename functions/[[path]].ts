import {
  CF_CONNECTING_IP_HEADER,
  FORWARDED_FOR_HEADER,
  FORWARDED_HOST_HEADER,
  FORWARDED_PROTO_HEADER,
  FORWARDED_URI_HEADER,
} from '../packages/shared/src/constants/Headers';

interface PagesProxyEnv {
  API_WORKER: Fetcher;
}

/**
 * Pages → Worker proxy.
 *
 * The Pages deployment serves the SPA's static files directly and forwards every
 * dynamic path here, so the Worker is the only place routing, auth, and the API
 * live. The forwarded headers carry the *original* request metadata, which the
 * Worker reads for the audit trail and for HMAC-signed internal self-calls —
 * a self-call made through this proxy would otherwise appear to originate from
 * Pages' own hostname.
 */
export const proxyToApi: PagesFunction<PagesProxyEnv> = async ({ request, env }) => {
  const originalUrl: URL = new URL(request.url);

  const headers: Headers = new Headers(request.headers);
  headers.set(FORWARDED_HOST_HEADER, originalUrl.host);
  headers.set(FORWARDED_PROTO_HEADER, originalUrl.protocol.replace(':', ''));
  headers.set(FORWARDED_URI_HEADER, `${originalUrl.pathname}${originalUrl.search}`);

  const clientIp: string | null = request.headers.get(CF_CONNECTING_IP_HEADER);
  if (clientIp) {
    headers.set(FORWARDED_FOR_HEADER, clientIp);
  }

  const hasBody: boolean = request.method !== 'GET' && request.method !== 'HEAD';
  const proxyRequest: Request = new Request(originalUrl.href, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    // A streamed body requires this on some runtimes; without it every non-GET
    // proxied request fails with a 500 from `new Request`.
    ...(hasBody && { duplex: 'half' }),
    redirect: request.redirect,
  });

  return env.API_WORKER.fetch(proxyRequest);
};

export const onRequest: PagesFunction<PagesProxyEnv> = proxyToApi;