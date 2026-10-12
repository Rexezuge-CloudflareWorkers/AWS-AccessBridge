import { createApiClient } from '@rexezuge/web/api';
import { ServiceError } from '@rexezuge/errors';

/**
 * One same-origin API client; fetch is resolved at call time for browser mocks.
 */
const apiClient = createApiClient((input, init) => fetch(input, init));

/**
 * Keep endpoint services on one typed request entrypoint.
 */
async function apiRequest<T>(url: string, options?: { method?: string; body?: unknown }): Promise<T> {
  return apiClient.request<T>(url, options);
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ServiceError && error.status === 401;
}

export { apiClient, apiRequest, isUnauthorized };
