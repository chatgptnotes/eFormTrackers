const crypto = require('crypto');

// ETag middleware for GET responses.
// Wraps res.json so that after the handler builds the body, we hash it,
// set the ETag header, and if the incoming If-None-Match matches,
// short-circuit with a 304 (no body).
//
// Skips:
//   - non-GET requests
//   - error responses (status >= 400)
//   - responses with Cache-Control: no-store
function etagMiddleware(req, res, next) {
  if (req.method !== 'GET') return next();
  const origJson = res.json.bind(res);
  res.json = (body) => {
    try {
      // Skip ETag for error responses.
      if (res.statusCode >= 400) {
        return origJson(body);
      }
      // Skip ETag if the handler opted out via Cache-Control: no-store.
      const cacheControl = res.getHeader('Cache-Control');
      if (cacheControl && String(cacheControl).toLowerCase().includes('no-store')) {
        return origJson(body);
      }
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      const hash = crypto.createHash('sha1').update(payload).digest('base64').slice(0, 27);
      const etag = `W/"${hash}"`;
      res.setHeader('ETag', etag);
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch === etag) {
        return res.status(304).end();
      }
    } catch (_) { /* fall through to normal send */ }
    return origJson(body);
  };
  next();
}

module.exports = { etagMiddleware };
