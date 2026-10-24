export interface ApiErrorBody { code: string; message: string; fields?: Record<string, string[]> }
export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) { super(body.message); }
}

let csrfToken: string | null = sessionStorage.getItem('cerberus.csrf');
export function setCsrfToken(token: string | null) {
  csrfToken = token;
  if (token) sessionStorage.setItem('cerberus.csrf', token);
  else sessionStorage.removeItem('cerberus.csrf');
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  meta?: Record<string, unknown>;
  error?: ApiErrorBody;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  [key: string]: unknown;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (csrfToken && init.method && !['GET', 'HEAD'].includes(init.method)) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'same-origin' });
  const payload = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !payload.ok) throw new ApiError(response.status, payload.error ?? { code: 'UNKNOWN', message: 'Request failed' });
  return payload;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const payload = await request<T>(path, init);
  return payload.data as T;
}

/** Same transport as api(), but retains list pagination metadata. */
export async function apiWithMeta<T, M extends Record<string, unknown> = PageMeta>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; meta: M }> {
  const payload = await request<T>(path, init);
  return { data: payload.data as T, meta: (payload.meta ?? {}) as M };
}

export function formatDate(epoch?: number | null) {
  if (!epoch) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(epoch * 1000));
}
