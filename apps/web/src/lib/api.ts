'use client';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  rawText: string;
}

interface ApiErrorShape {
  Exception?: { Message?: string };
  message?: string;
}

function extractErrorMessage(status: number, text: string): string {
  if (!text) return `HTTP ${status}`;
  try {
    const err = JSON.parse(text) as ApiErrorShape;
    return err.Exception?.Message || err.message || `HTTP ${status}: ${text}`;
  } catch {
    return `HTTP ${status}: ${text}`;
  }
}

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

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export { ApiError, readErrorMessage, throwForResponse, isUnauthorized };

export async function apiFetch<T>(url: string, options?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  const method: string = options?.method ?? 'GET';
  try {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (options?.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(url, init);
    const rawText: string = await response.text();
    if (response.ok) {
      if (!rawText) {
        return { ok: true, status: response.status, data: null, rawText };
      }
      try {
        return { ok: true, status: response.status, data: JSON.parse(rawText) as T, rawText };
      } catch {
        return { ok: true, status: response.status, data: rawText as unknown as T, rawText };
      }
    }
    return { ok: false, status: response.status, data: null, error: extractErrorMessage(response.status, rawText), rawText };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: `Network error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      rawText: '',
    };
  }
}

export async function apiCall(
  url: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const result = await apiFetch<Record<string, unknown>>(url, { method, body });
  if (result.ok) {
    return { ok: true, data: result.data ?? {} };
  }
  return { ok: false, error: result.error };
}
