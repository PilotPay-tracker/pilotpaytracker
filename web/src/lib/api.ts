/**
 * Web API Client
 * Reuses shared contracts from @shared/contracts
 * Adapted from mobile/src/lib/api.ts for browser environment
 *
 * All requests use relative /api/* URLs (same-origin).
 * - Dev: Vite proxy forwards /api → localhost:3000
 * - Prod: Vercel Edge Functions at web/api/* proxy to the backend,
 *         keeping the browser on the frontend domain so session cookies work.
 */

// Always relative — browser never talks directly to the backend domain.
export const BACKEND_URL = '';

const REQUEST_TIMEOUT = 15000;

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

interface FetchOptions {
  method: HttpMethod;
  body?: object;
  timeout?: number;
}

function createTimeoutController(timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
}

const fetchFn = async <T>(path: string, options: FetchOptions): Promise<T> => {
  const { method, body, timeout = REQUEST_TIMEOUT } = options;
  const { controller, timeoutId } = createTimeoutController(timeout);

  try {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorData: { error?: string; message?: string } = {};
      try {
        errorData = await response.json();
      } catch {
        // not JSON
      }

      let errorMessage = errorData.error || errorData.message || response.statusText;

      if (response.status === 401) {
        errorMessage = 'Please sign in to continue.';
      } else if (response.status === 404) {
        errorMessage = 'Service temporarily unavailable.';
      } else if (response.status >= 500) {
        errorMessage = 'Server error. Please try again.';
      }

      const error = new Error(errorMessage) as Error & { status: number };
      error.status = response.status;
      throw error;
    }

    return response.json() as Promise<T>;
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out.');
    }
    throw error;
  }
};

export const api = {
  get: <T>(path: string, timeout?: number) =>
    fetchFn<T>(path, { method: 'GET', timeout }),
  post: <T>(path: string, body?: object, timeout?: number) =>
    fetchFn<T>(path, { method: 'POST', body, timeout }),
  put: <T>(path: string, body?: object, timeout?: number) =>
    fetchFn<T>(path, { method: 'PUT', body, timeout }),
  patch: <T>(path: string, body?: object, timeout?: number) =>
    fetchFn<T>(path, { method: 'PATCH', body, timeout }),
  delete: <T>(path: string, timeout?: number) =>
    fetchFn<T>(path, { method: 'DELETE', timeout }),
};
