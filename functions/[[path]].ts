interface PagesProxyEnv {
  API_WORKER: Fetcher;
}

const CF_CONNECTING_IP_HEADER = 'CF-Connecting-IP';
const FORWARDED_FOR_HEADER = 'X-Forwarded-For';
const FORWARDED_HOST_HEADER = 'X-Forwarded-Host';
const FORWARDED_PROTO_HEADER = 'X-Forwarded-Proto';
const FORWARDED_URI_HEADER = 'X-Forwarded-Uri';

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

  const proxyRequest: Request = new Request(originalUrl.href, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: request.redirect,
  });

  return env.API_WORKER.fetch(proxyRequest);
};

export const onRequest: PagesFunction<PagesProxyEnv> = proxyToApi;
