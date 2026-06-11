/**
 * Read which JotForm API key bucket to use based on a request header.
 * 'gdmo' → the GDMO-specific key; everything else → default.
 */
function readKeyType(req) {
  // Default to 'gdmo' (the only configured key in this deployment). Callers that
  // don't set the header — including bare fetch() calls — should hit Production,
  // not the unconfigured Testing key. Only an explicit 'default' opts out.
  const v = req.headers['x-jotform-key-type'] || req.query?.keyType;
  return v === 'default' ? 'default' : 'gdmo';
}

module.exports = { readKeyType };
