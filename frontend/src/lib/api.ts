import { jotformHeaders } from './jotformKey';

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
  // Always forward the active JotForm key choice to the backend so handlers
  // that proxy to JotForm pick the right key/team scoping. Harmless on
  // non-JotForm endpoints — they just ignore the header.
  const jfHdrs = jotformHeaders();
  // DEBUG: visible in browser console — confirm header is being sent on each call.
  // eslint-disable-next-line no-console
  console.log(`[apiFetch] ${init.method || 'GET'} ${path}  x-jotform-key-type=${(jfHdrs as Record<string,string>)['x-jotform-key-type']}`);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...jfHdrs, ...init.headers },
  });
  if (!res.ok && throwOnError) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `API error: ${res.status}`);
  }
  return res.json();
}
