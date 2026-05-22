const API_BASE = '';

export interface ApiFetchOptions extends RequestInit {
  /** If false, skip the !res.ok throw and return the parsed body even on non-2xx responses. */
  throwOnError?: boolean;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const { throwOnError = true, ...init } = options;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok && throwOnError) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `API error: ${res.status}`);
  }
  return res.json();
}
