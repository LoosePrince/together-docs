export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { credentials: 'include', ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.message || '操作失败，请重试', response.status);
  return data;
}
export const post = <T = unknown>(url: string, body?: unknown): Promise<T> => api(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = (url: string, body: unknown) => api(url, { method: 'PATCH', body: JSON.stringify(body) });
export const put = (url: string, body: unknown) => api(url, { method: 'PUT', body: JSON.stringify(body) });
export const del = (url: string) => api(url, { method: 'DELETE' });
export type Account = { id: string; username: string; displayName: string; siteAdmin: boolean };
export type Resource = { id: string; name: string; type: string; ownerId: string; projectId: string | null; parentId: string | null; updatedAt: string; fileId: string | null; deletedAt: string | null; role?: string; personas?: Record<string, string> };
