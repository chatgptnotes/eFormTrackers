const env = require('../config/env');

function resolveApiKey(keyType) {
  if (keyType === 'gdmo') return env.JOTFORM_API_KEY_GDMO || env.JOTFORM_API_KEY;
  return env.JOTFORM_API_KEY;
}

/**
 * Fetch from JotForm API. The API key is passed via the `APIKEY` request
 * header (never in the URL) so the secret never appears in URL logs.
 *
 * Key/scope rules (empirically verified against eforms.mediaoffice.ae):
 *  - keyType 'default' (regular JotForm API key): use the path as-is and
 *    append `teamID` from env so the call is scoped to the configured team.
 *  - keyType 'gdmo' (Enterprise admin key): rewrite leading `user/` to
 *    `enterprise/` (e.g. `user/forms` → `enterprise/forms`) for tenant-wide
 *    scope, and DO NOT append `teamID` — the Enterprise admin key already has
 *    org-wide access and adding teamID either re-scopes or fails. Resource-id
 *    paths (`form/{id}/...`, `submission/{id}`, `workflow/instance/{id}`)
 *    are untouched — they're global lookups by id.
 *
 * Build a manual URL via `buildJotformUrl(path, keyType)` (exported below) for
 * call sites that need fetch() directly (POSTs with custom bodies, DELETE).
 * Those call sites must set the `APIKEY` header themselves via `resolveApiKey`.
 *
 * @param {string} path  e.g. "user/forms", "submission/123", "form/{id}/questions"
 * @param {object} [opts]  { params, method, body, headers, keyType }
 *   keyType: 'default' (env JOTFORM_API_KEY, gets teamID) |
 *            'gdmo'    (env JOTFORM_API_KEY_GDMO, user/* → enterprise/*, no teamID)
 *   Undefined keyType is treated as 'default'.
 * @returns {Promise<object>} parsed JSON response
 */
async function jotformFetch(path, opts = {}) {
  const url = buildJotformUrl(path, opts.keyType);

  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      url.searchParams.set(k, String(v));
    }
  }

  const apiKey = resolveApiKey(opts.keyType);
  const fetchOpts = {
    method: opts.method || 'GET',
    headers: { 'APIKEY': apiKey, ...(opts.headers || {}) },
  };
  if (opts.body) {
    fetchOpts.body = opts.body;
    if (!fetchOpts.headers['Content-Type']) {
      fetchOpts.headers['Content-Type'] = 'application/json';
    }
  }

  // Bound every JotForm call with a timeout. A hung upstream used to stall the
  // poller / webhook / admin-sync indefinitely; an AbortController forces it to
  // surface as an error after `timeoutMs` so callers can move on.
  const timeoutMs = opts.timeoutMs || 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url.toString(), { ...fetchOpts, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error(`JotForm API timeout after ${timeoutMs}ms: ${path}`);
      err.code = 'JOTFORM_TIMEOUT';
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  // Tolerate non-JSON error responses (5xx HTML pages, gateway errors).
  const ct = response.headers.get('content-type') || '';
  const data = ct.includes('json') ? await response.json().catch(() => ({})) : { error: (await response.text().catch(() => '')).slice(0, 500) };

  // JotForm rate-limit: retry once after the Retry-After delay (or 60s default).
  if (response.status === 429 && !opts._retried) {
    const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10);
    const waitMs = Math.min(retryAfter * 1000, 120000);
    console.warn(`[jotform] 429 on ${path} — waiting ${waitMs / 1000}s before retry`);
    await new Promise(r => setTimeout(r, waitMs));
    return jotformFetch(path, { ...opts, _retried: true });
  }

  if (!response.ok) {
    const err = new Error(`JotForm API error: ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * Build a JotForm URL with the same path/scope rules as jotformFetch — for
 * call sites that need to fetch() directly (e.g. multipart POST, DELETE).
 * Returns a URL object so the caller can add more searchParams if needed.
 *
 * IMPORTANT: this no longer adds `apiKey` to the URL. Callers must send the
 * key via the `APIKEY` request header (use `resolveApiKey(keyType)`).
 */
function buildJotformUrl(path, keyType) {
  const isGdmo = keyType === 'gdmo';
  const effectivePath = isGdmo && path.startsWith('user/')
    ? 'enterprise/' + path.slice('user/'.length)
    : path;
  const url = new URL(`${env.JOTFORM_BASE}/${effectivePath}`);
  if (!isGdmo && env.JOTFORM_TEAM_ID) url.searchParams.set('teamID', env.JOTFORM_TEAM_ID);
  // L-5: Use the module-level logger (not console.log) so output is controlled by log level.
  return url;
}

module.exports = { jotformFetch, resolveApiKey, buildJotformUrl };
