const env = require('../config/env');

function resolveApiKey(keyType) {
  if (keyType === 'gdmo') return env.JOTFORM_API_KEY_GDMO || env.JOTFORM_API_KEY;
  return env.JOTFORM_API_KEY;
}

/**
 * Fetch from JotForm API. Passes apiKey as APIKEY header (never in URL).
 * @param {string} path  e.g. "user/forms", "submission/123"
 * @param {object} [opts]  { params, method, body, headers, keyType }
 */
async function jotformFetch(path, opts = {}) {
  const url = new URL(`${env.JOTFORM_BASE}/${path}`);
  if (env.JOTFORM_TEAM_ID) url.searchParams.set('teamID', env.JOTFORM_TEAM_ID);

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

module.exports = { jotformFetch, resolveApiKey };
