const env = require('../config/env');

function resolveApiKey(keyType) {
  if (keyType === 'gdmo') return env.JOTFORM_API_KEY_GDMO || env.JOTFORM_API_KEY;
  return env.JOTFORM_API_KEY;
}

/**
 * Fetch from JotForm API. Appends apiKey and teamID automatically.
 * @param {string} path  e.g. "user/forms", "submission/123"
 * @param {object} [opts]  { params, method, body, headers, keyType }
 *   keyType: 'default' (env JOTFORM_API_KEY) | 'gdmo' (env JOTFORM_API_KEY_GDMO)
 * @returns {Promise<object>} parsed JSON response
 */
async function jotformFetch(path, opts = {}) {
  const url = new URL(`${env.JOTFORM_BASE}/${path}`);
  url.searchParams.set('apiKey', resolveApiKey(opts.keyType));
  if (env.JOTFORM_TEAM_ID) url.searchParams.set('teamID', env.JOTFORM_TEAM_ID);

  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      url.searchParams.set(k, String(v));
    }
  }

  const fetchOpts = { method: opts.method || 'GET' };
  if (opts.body) {
    fetchOpts.body = opts.body;
    fetchOpts.headers = opts.headers || { 'Content-Type': 'application/json' };
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
