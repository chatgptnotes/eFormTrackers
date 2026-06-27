/**
 * Shared parsing helpers for JotForm email bodies.
 *
 * Extracted from routes/workflow-emails.js so the email archiver
 * (lib/email-archiver.js) and the per-user email route reuse one copy.
 */

// JotForm wraps action buttons in a /deeplink URL that tries to open the
// mobile app and falls back to the App Store. The real web URL is in the
// `redirect` query param — unwrap it so buttons open the actual task page.
function unwrapDeeplink(url) {
  if (!url.includes('/deeplink')) return url;
  try {
    const u = new URL(url);
    return u.searchParams.get('redirect') || url;
  } catch {
    return url;
  }
}

// Extract <a href="...">TEXT</a> pairs from HTML
function extractAnchorLinks(html) {
  if (!html) return [];
  const results = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = unwrapDeeplink(m[1].trim().replace(/&amp;/gi, '&'));
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (url && url.startsWith('http')) results.push({ url, text });
  }
  return results;
}

// Classify a link as a workflow action
function classifyLink({ url, text }) {
  const u = url.toLowerCase();
  const t = text.toLowerCase();

  if (t.includes('approv') || u.includes('approv')) return { label: 'Approve', type: 'approve', url };
  if (t.includes('reject') || t.includes('deny') || u.includes('reject') || u.includes('deny')) return { label: 'Reject', type: 'reject', url };
  if (t.includes('fill') || t.includes('complete') || t.includes('submit') || u.includes('/form/')) return { label: 'Fill Form', type: 'fill', url };
  if (t.includes('view') || t.includes('open') || t.includes('review') || u.includes('inbox') || u.includes('task')) return { label: 'Open Task', type: 'task', url };

  return null;
}

// Build the deduped action-link list for an email body
function extractActionLinks(html) {
  return extractAnchorLinks(html)
    .map(classifyLink)
    .filter(Boolean)
    // Deduplicate by type (keep first occurrence)
    .filter((l, i, arr) => arr.findIndex(x => x.type === l.type) === i);
}

// Strip HTML tags and collapse whitespace into a plain preview
function htmlToPreview(html, maxLen = 250) {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

module.exports = { unwrapDeeplink, extractAnchorLinks, classifyLink, extractActionLinks, htmlToPreview };
