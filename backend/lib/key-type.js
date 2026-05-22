/**
 * Read which JotForm API key bucket to use based on a request header.
 * 'gdmo' → the GDMO-specific key; everything else → default.
 */
function readKeyType(req) {
  const v = req.headers['x-jotform-key-type'] || req.query?.keyType;
  return v === 'gdmo' ? 'gdmo' : 'default';
}

module.exports = { readKeyType };
