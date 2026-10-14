import { createPagesProxy } from '@rexezuge/tooling/functions/pages-proxy';

/**
 * Pages → Worker proxy.
 *
 * The Pages deployment serves the SPA's static files directly and forwards every
 * dynamic path here, so the Worker is the only place routing, auth, and the API
 * live. The forwarded headers carry the *original* request metadata, which the
 * Worker reads for the audit trail and for HMAC-signed internal self-calls — a
 * self-call made through this proxy would otherwise appear to originate from
 * Pages' own hostname.
 *
 * The kit's factory is strictly stricter than the copy it replaces: it deletes
 * every forwarding header the client could have set — `X-Real-Ip`,
 * `True-Client-IP`, `Forwarded`, and the `X-Forwarded-*` family — before writing
 * the three the Worker trusts. The copy here passed `request.headers` through
 * verbatim and then overwrote three names, which meant a client that sent
 * `X-Real-Ip` had it forwarded to the Worker as if it were true. Every one of
 * those headers names a *client's* claim about the network path, and the Worker
 * is the only party that can know the real one.
 *
 * The body guard and `duplex: 'half'` are the factory's too: without the latter
 * every non-GET proxied request fails with a 500 from `new Request`.
 */
export const proxyToApi = createPagesProxy();

export const onRequest = proxyToApi;
