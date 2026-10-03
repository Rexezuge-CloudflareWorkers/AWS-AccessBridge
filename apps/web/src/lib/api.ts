'use client';

export async function readJson<T>(response: Response): Promise<T> {
  return response.json();
}

class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json().catch(() => null)) as { Exception?: { Message?: string } } | null;
    return data?.Exception?.Message || `${fallback}: ${response.status} ${response.statusText}`;
  } catch {
    return `${fallback}: ${response.status} ${response.statusText}`;
  }
}

async function throwForResponse(response: Response, fallback: string): Promise<never> {
  throw new ApiError(response.status, await readErrorMessage(response, fallback));
}

/**
 * Whether an error means "sign in again", which is what shows the `Unauthorized`
 * screen. Only 401 — a 403 is a real answer (authenticated, but not permitted),
 * so treating it as "session expired" would send an administrator to the Zero
 * Trust login page for something re-authenticating cannot fix.
 */
function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export { ApiError, throwForResponse, isUnauthorized };

/**
 * Canonical typed request helper (thrown-`ApiError` model).
 *
 * Previously two parallel error models coexisted: this one, and an
 * `ApiResult{ok,status,data,error}` shape reached through `apiFetch`/`apiCall`
 * that the seven admin tabs called directly. That left the whole admin UI on the
 * untested half of the pair while the tested half went unused, and duplicated
 * the `result.ok ? … : showMessage(result.error)` branch in every tab. The
 * compat layer is gone; `apiRequest` is the only request path.
 */
export async function apiRequest<T>(url: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const method: string = options?.method ?? 'GET';
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (options?.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(url, init);
  if (!response.ok) {
    await throwForResponse(response, `Request failed: ${method} ${url}`);
  }
  if (response.status === 204) {
    return {} as T;
  }
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    // A 2xx body that is not JSON (an HTML error page from a proxy, say) must
    // surface as an ApiError, not a SyntaxError: `isUnauthorized` and the
    // Unauthorized screen only recognise ApiError, so a raw SyntaxError would
    // defeat the 401 handling this path exists to drive.
    throw new ApiError(response.status, `Malformed response body: ${method} ${url}`);
  }
}
