// Central error humanization. Every feature failure should surface a clear,
// user-facing sentence — never a raw status code like "API error: 500".

/** HTTP status → default human-readable message. */
const STATUS_MESSAGES: Record<number, string> = {
  400: 'The request was invalid. Please check your input and try again.',
  401: 'Your session has expired. Please sign in again.',
  403: "You don't have permission to do this.",
  404: "We couldn't find what you were looking for — it may have been moved or deleted.",
  408: 'The request timed out. Please try again.',
  409: 'This conflicts with the current state — it may have already been updated. Refresh and try again.',
  413: 'The file or request is too large.',
  422: 'Some of the information provided was invalid. Please review and try again.',
  429: 'Too many requests — please slow down and try again in a moment.',
  500: 'Something went wrong on our end. Please try again in a moment.',
  502: 'The server is temporarily unreachable. Please try again shortly.',
  503: 'The service is temporarily unavailable. Please try again shortly.',
  504: 'The request took too long to complete. Please try again.',
};

/** A network failure (server unreachable, DNS, offline, CORS preflight refused). */
export const NETWORK_ERROR_MESSAGE =
  "Can't reach the server. Check your connection and try again.";

/**
 * Error thrown by apiFetch. Carries the HTTP status plus the raw server message
 * so callers can branch on status while `message` is already human-readable.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly serverMessage?: string;
  constructor(message: string, status: number, serverMessage?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

/**
 * True when a backend-supplied string is a real, user-readable sentence — not an
 * opaque generic ("Internal server error"), a bare code ("API error: 500"), or a
 * machine token ("NO_ACTIVE_TASK"). These should be replaced with friendly text.
 */
export function isHumanMessage(msg?: string | null): boolean {
  if (!msg) return false;
  const m = String(msg).trim();
  if (m.length < 3) return false;
  if (/^internal server error\.?$/i.test(m)) return false;
  if (/^(api (error|returned)|error|request failed)[:\s-]*\d+/i.test(m)) return false;
  if (/^\d+$/.test(m)) return false;
  if (/^[A-Z][A-Z0-9_]+$/.test(m)) return false;
  return true;
}

/**
 * Best human message for an HTTP status, preferring a usable server message when
 * one is present, otherwise the canonical message for that status.
 */
export function messageFromStatus(status: number, serverMessage?: string | null): string {
  if (isHumanMessage(serverMessage)) return String(serverMessage).trim();
  return STATUS_MESSAGES[status] || `Something went wrong (error ${status}). Please try again.`;
}

/**
 * Turn ANY thrown value into a clear, user-facing sentence. Never returns a raw
 * status code or stack trace. Use this in every catch block that shows the error
 * to the user (alert/toast/inline). Keep console logging on the raw error.
 */
export function humanizeError(
  err: unknown,
  fallback = 'Something went wrong. Please try again.'
): string {
  if (err instanceof ApiError) return messageFromStatus(err.status, err.serverMessage);

  // Aborted/timed-out fetch
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'The request timed out. Please try again.';
  }

  if (err instanceof Error) {
    if (err.name === 'AbortError') return 'The request timed out. Please try again.';
    // Browser network failures surface as TypeError: "Failed to fetch" / "Load failed" / "NetworkError"
    if (/failed to fetch|networkerror|load failed|err_|network request failed/i.test(err.message)) {
      return NETWORK_ERROR_MESSAGE;
    }
    if (isHumanMessage(err.message)) return err.message;
    return fallback;
  }

  if (typeof err === 'string' && isHumanMessage(err)) return err;
  return fallback;
}
