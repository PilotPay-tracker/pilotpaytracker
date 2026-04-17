/**
 * API client for the landing/web app (Next.js)
 *
 * All API calls from this file are initiated by React Query hooks (lib/hooks.ts)
 * which only run in the browser (client-side). Server Components that need
 * backend data use direct fetch() with process.env.NEXT_PUBLIC_BACKEND_URL —
 * they do NOT import this module.
 *
 * Using '' (same-origin) means the browser sends the request to
 * pilotpaytracker.vercel.app/api/*, which the Next.js rewrite in
 * next.config.js then proxies to the backend with the Cookie header intact.
 * No typeof window needed — this module is client-only.
 */
const BACKEND_URL = ''

export { BACKEND_URL }

const REQUEST_TIMEOUT = 15000

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

interface FetchOptions {
  method: HttpMethod
  body?: object
  timeout?: number
}

function createTimeoutController(timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  return { controller, timeoutId }
}

const fetchFn = async <T>(path: string, options: FetchOptions): Promise<T> => {
  const { method, body, timeout = REQUEST_TIMEOUT } = options
  const { controller, timeoutId } = createTimeoutController(timeout)

  try {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      let errorData: { error?: string; message?: string } = {}
      try {
        errorData = await response.json()
      } catch {
        // not JSON
      }

      let errorMessage = errorData.error || errorData.message || response.statusText

      if (response.status === 401) {
        errorMessage = 'Please sign in to continue.'
      } else if (response.status === 404) {
        errorMessage = 'Service temporarily unavailable.'
      } else if (response.status >= 500) {
        errorMessage = 'Server error. Please try again.'
      }

      const error = new Error(errorMessage) as Error & { status: number }
      error.status = response.status
      throw error
    }

    return response.json() as Promise<T>
  } catch (error: unknown) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out.')
    }
    throw error
  }
}

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
}
