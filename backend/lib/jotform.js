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

  const response = await fetch(url.toString(), fetchOpts);
  const data = await response.json();
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
  // DEBUG: visible in backend console — confirm keyType routing per request.
  console.log(`[jotform] keyType=${keyType || 'default(implicit)'}  path=${path}  ->  ${url.toString()}`);
  return url;
}

module.exports = { jotformFetch, resolveApiKey, buildJotformUrl };
