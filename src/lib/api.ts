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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (csrfToken && init.method && !['GET', 'HEAD'].includes(init.method)) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'same-origin' });
  const payload = await response.json() as { ok: boolean; data?: T; error?: ApiErrorBody };
  if (!response.ok || !payload.ok) throw new ApiError(response.status, payload.error ?? { code: 'UNKNOWN', message: 'Request failed' });
  return payload.data as T;
}

export function formatDate(epoch?: number | null) {
  if (!epoch) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(epoch * 1000));
}
