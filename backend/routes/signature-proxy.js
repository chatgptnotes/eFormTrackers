/**
 * Signature proxy
 *
 * JotForm /uploads/ files (signatures, attachments) require auth — a plain
 * request redirects to the JotForm login page. BUT requesting the same URL
 * WITH ?apiKey=<key> returns a 302 redirect to a short-lived *signed* URL
 * (/_fs/jufs-XXXX/...?md5=...&expires=...) which is publicly fetchable.
 *
 * This proxy appends the apiKey, follows the redirect to the signed URL, and
 * streams the resulting image bytes back to the browser. Frontend just points
 * <img src="/api/signature-proxy?url=<uploads_url>"> — works for every
 * authenticated dashboard user, no JotForm session needed on their side.
 *
 * Security:
 *  - requireAuth: only logged-in dashboard users can hit this proxy
 *  - SSRF guard: target URL host MUST equal env.JOTFORM_HOST
 *  - keyType from x-jotform-key-type header → correct key (default vs gdmo)
 *  - 24h browser cache on success
 */
const { Router } = require('express');
const env = require('../config/env');
const { requireAuth } = require('../middleware/auth');
const { resolveApiKey } = require('../lib/jotform');
const { readKeyType } = require('../lib/key-type');

const router = Router();

const ALLOWED_HOST = env.JOTFORM_HOST.replace(/^https?:\/\//, '').replace(/\/$/, '');

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
    if (target.host !== ALLOWED_HOST) {
      return res.status(400).json({ error: `URL host not allowed (must be ${ALLOWED_HOST})` });
    }

    // Append apiKey so JotForm 302-redirects to a public signed URL, then
    // follow the redirect to fetch the actual image bytes.
    const keyType = readKeyType(req);
    target.searchParams.set('apiKey', resolveApiKey(keyType));

    const upstream = await fetch(target.toString(), { redirect: 'follow' });
    const ct = upstream.headers.get('content-type') || '';

    if (!upstream.ok || !ct.startsWith('image/')) {
      req.log.warn({ status: upstream.status, contentType: ct, url: urlStr },
        '[signature-proxy] did not resolve to an image');
      return res.status(404).json({
        error: 'Signature not accessible — the file may not exist or the API key lacks access.',
      });
    }

    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) { next(err); }
});

module.exports = router;
