/**
 * Signature proxy
 *
 * JotForm /uploads/ files (signatures, attachments) are protected by JotForm's
 * browser session — not by API key. So a plain <img src=jotformUrl> in the
 * dashboard fails for any user not currently logged into JotForm at
 * eforms.mediaoffice.ae.
 *
 * This proxy fetches the URL server-side using a stored JotForm session
 * cookie (set via env.JOTFORM_SESSION_COOKIE) and streams the image bytes
 * back. Frontend renders <img src="/api/signature-proxy?url=...">; cookies
 * stay on the backend and every authenticated dashboard user can view the
 * signature regardless of their JotForm login state.
 *
 * Security:
 *  - requireAuth: only logged-in dashboard users can hit this proxy
 *  - SSRF guard: target URL host MUST match the configured JOTFORM_HOST
 *    allowlist (currently a single host); blocks fetching arbitrary URLs
 *  - 24h browser cache on success — signatures don't change after the fact
 */
const { Router } = require('express');
const env = require('../config/env');
const { requireAuth } = require('../middleware/auth');

const router = Router();

const ALLOWED_HOSTS = new Set([
  env.JOTFORM_HOST.replace(/^https?:\/\//, '').replace(/\/$/, ''),
]);

router.get('/signature-proxy', requireAuth, async (req, res, next) => {
  try {
    const urlStr = String(req.query.url || '');
    if (!urlStr) return res.status(400).json({ error: 'url query parameter required' });

    let target;
    try { target = new URL(urlStr); } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }
    if (target.protocol !== 'https:') {
      return res.status(400).json({ error: 'Only https:// URLs allowed' });
    }
    if (!ALLOWED_HOSTS.has(target.host)) {
      return res.status(400).json({ error: `URL host not allowed (must be one of: ${[...ALLOWED_HOSTS].join(', ')})` });
    }

    const headers = {};
    if (env.JOTFORM_SESSION_COOKIE) headers['Cookie'] = env.JOTFORM_SESSION_COOKIE;
    if (env.JOTFORM_API_KEY_GDMO) headers['APIKEY'] = env.JOTFORM_API_KEY_GDMO;

    const upstream = await fetch(target.toString(), { headers, redirect: 'manual' });
    const ct = upstream.headers.get('content-type') || '';

    // Auth failure pattern: JotForm responds 200 with text/html (login page) OR
    // 302 redirecting to /login. Treat both as "signature not accessible".
    if (upstream.status >= 300 && upstream.status < 400) {
      req.log.warn({ status: upstream.status, location: upstream.headers.get('location') },
        '[signature-proxy] upstream redirected — session cookie may be missing or expired');
      return res.status(404).json({
        error: 'Signature not accessible — JotForm session expired or missing. Re-set JOTFORM_SESSION_COOKIE in backend/.env',
      });
    }
    if (!ct.startsWith('image/')) {
      req.log.warn({ status: upstream.status, contentType: ct },
        '[signature-proxy] upstream returned non-image — session cookie may be missing or expired');
      return res.status(404).json({
        error: 'Signature not accessible — JotForm returned non-image content. Backend session cookie may need refresh.',
      });
    }

    // Stream the image bytes through.
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) { next(err); }
});

module.exports = router;
