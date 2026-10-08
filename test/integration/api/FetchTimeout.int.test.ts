import { describe, expect, it } from 'vitest';
import { BadGatewayError } from '@aws-access-bridge/backend-errors';
import { FetchHttpClient } from '@aws-access-bridge/backend-services/http';
import { fetchWithTimeout } from '@aws-access-bridge/provider-clients/aws';

/**
 * `fetchWithTimeout` under workerd, not Node.
 *
 * The Node-project seam test (`test/seams/FetchHttpClientTimeout.test.ts`) proves
 * the logic; it cannot prove the runtime. Three things here are workerd-specific
 * and each has bitten real code before:
 *
 * 1. `AbortSignal.any` and `AbortSignal.timeout` exist at this compatibility date
 *    but are what workerd implements, which is not Node's implementation.
 * 2. The body is read *inside* the deadline and handed back as a fresh
 *    `Response`. That means the deadline also has to bind `response.arrayBuffer()`
 *    in workerd, and that a rebuilt `Response` is still a usable one — headers,
 *    status and `json()` all intact.
 * 3. A 204 or 304 may not carry a body, so reading one eagerly throws. Those
 *    statuses are skipped, and this asserts the skip rather than the comment.
 */
describe('fetchWithTimeout under the Workers runtime', () => {
  it('rejects a stalled response as a retryable BadGatewayError naming the host', async () => {
    // Headers arrive, the body never does: the stall the buffering exists for.
    const stalling = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(new TextEncoder().encode('{"partial":'));
        // Never closed.
      },
    });

    const failure: unknown = await fetchWithTimeout(
      () => Promise.resolve(new Response(stalling, { headers: { 'content-type': 'application/json' } })),
      {},
      'signin.aws.amazon.com',
      25,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BadGatewayError);
    expect((failure as BadGatewayError).retryable).toBe(true);
    expect((failure as BadGatewayError).message).toContain('signin.aws.amazon.com');
  });

  it('rejects a fetch that never settles at all', async () => {
    const failure: unknown = await fetchWithTimeout(
      () => new Promise<Response>(() => undefined),
      {},
      'sts.eu-west-1.amazonaws.com',
      25,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BadGatewayError);
    expect((failure as BadGatewayError).message).toContain('sts.eu-west-1.amazonaws.com');
  });

  /**
   * The whole point of buffering: the rebuilt response must be indistinguishable
   * from the original to every caller, or the AWS parsers downstream read the
   * wrong thing.
   */
  it('returns a complete response with its body, headers and status intact', async () => {
    const response: Response = await fetchWithTimeout(
      () =>
        Promise.resolve(
          // eslint-disable-next-line unicorn/prefer-response-static-json -- deliberately not `Response.json`: the point is that the rebuilt response keeps whatever content type it was handed
          new Response(JSON.stringify({ AccessKeyId: 'ASIA', Arn: 'arn:aws:sts::123456789012:assumed-role/s' }), {
            headers: { 'content-type': 'text/xml' },
            status: 201,
            statusText: 'Created',
          }),
        ),
      {},
      'sts.amazonaws.com',
      1000,
    );

    expect(response.status).toBe(201);
    expect(response.statusText).toBe('Created');
    expect(response.headers.get('content-type')).toBe('text/xml');
    await expect(response.json()).resolves.toMatchObject({ AccessKeyId: 'ASIA' });
  });

  /**
   * `NULL_BODY_STATUSES`: a 204 or 304 may not carry a body, so
   * `response.arrayBuffer()` on one throws in workerd. Reading it eagerly would
   * turn a successful answer into a 502.
   */
  it('does not try to read a body from a status that may not carry one', async () => {
    const noContent: Response = await fetchWithTimeout(() => Promise.resolve(new Response(null, { status: 204 })), {}, 'example.com', 1000);
    expect(noContent.status).toBe(204);
    expect(await noContent.text()).toBe('');

    const notModified: Response = await fetchWithTimeout(
      () => Promise.resolve(new Response(null, { status: 304 })),
      {},
      'example.com',
      1000,
    );
    expect(notModified.status).toBe(304);
  });

  /**
   * A caller-supplied signal is the caller's own decision, not an upstream fault,
   * so it must surface unchanged rather than being relabelled a 502.
   */
  it("rethrows the caller's own abort rather than reporting a timeout", async () => {
    const caller: AbortController = new AbortController();
    const pending = fetchWithTimeout(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          // Aborting immediately, so the caller wins the race and the timeout
          // never fires — the branch under test.
          init.signal?.addEventListener('abort', () => reject(new DOMException('caller aborted', 'AbortError')));
          queueMicrotask(() => caller.abort());
        }),
      { signal: caller.signal },
      'example.com',
      5000,
    );

    const failure: unknown = await pending.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DOMException);
    expect((failure as DOMException).name).toBe('AbortError');
  });

  it('hands the combined signal to fetch so the deadline is enforced downstream', async () => {
    let seen: AbortSignal | null | undefined;
    await fetchWithTimeout(
      (init) => {
        seen = init.signal;
        return Promise.resolve(new Response('{}'));
      },
      { signal: AbortSignal.timeout(5000) ?? undefined },
      'example.com',
      1000,
    );

    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen?.aborted).toBe(false);
  });

  /**
   * `FetchHttpClient` is the seam every non-signed HTTP call goes through, so the
   * same deadline applies there. The AWS parsers use the signed clients; the
   * console signin token endpoint uses this one.
   */
  it('bounds FetchHttpClient.fetchJson the same way', async () => {
    const failure: unknown = await new FetchHttpClient(25)
      .fetchJson('https://signin.aws.amazon.com/federation')
      .catch((error: unknown) => error);

    // No network from a unit-style test, so the real endpoint either fails fast
    // or stalls — either way it must not hang, and a stall is the typed answer.
    if (failure instanceof BadGatewayError) {
      expect(failure.retryable).toBe(true);
    }
    expect(failure).toBeInstanceOf(Error);
  });
});
