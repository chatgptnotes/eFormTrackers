import { ApiError, messageFromStatus, NETWORK_ERROR_MESSAGE } from './errors';

const API_BASE = '';

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch {
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const serverMessage = (body as { error?: string }).error;
    throw new ApiError(messageFromStatus(res.status, serverMessage), res.status, serverMessage);
  }
  return res.json();
}
