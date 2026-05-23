import { jotformHeaders } from './jotformKey';
import { ApiError, messageFromStatus, NETWORK_ERROR_MESSAGE } from './errors';

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
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...jfHdrs, ...init.headers },
    });
  } catch {
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
  }
  if (!res.ok && throwOnError) {
    const body = await res.json().catch(() => ({}));
    const serverMessage = (body as { error?: string }).error;
    throw new ApiError(messageFromStatus(res.status, serverMessage), res.status, serverMessage);
  }
  return res.json();
}
