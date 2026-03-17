import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY;
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '260541093809054';
const WEBHOOK_SECRET = process.env.JOTFORM_WEBHOOK_SECRET || '';

/**
 * POST /api/register-webhooks
 *
 * Dynamically discovers all ENABLED forms via GET /user/forms and registers
 * JotFlow's webhook URL on each one. No hardcoded form IDs required.
 *
 * Idempotent — JotForm deduplicates webhook URLs, so safe to call multiple times.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  if (!API_KEY) return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });

  // Step 1: Discover all ENABLED forms dynamically
  let formIds: string[];
  try {
    const formsRes = await fetch(
      `${JOTFORM_BASE}/user/forms?apiKey=${API_KEY}&teamID=${TEAM_ID}&limit=200&orderby=updated_at`
    );
    if (!formsRes.ok) {
      return res.status(500).json({ error: `Failed to fetch forms: ${formsRes.status}` });
    }
    const formsData = await formsRes.json();
    const allForms = (formsData.content || []) as Array<{ id: string; status: string; title?: string }>;
    formIds = allForms
      .filter(f => f.status === 'ENABLED')
      .map(f => f.id);
  } catch (err) {
    return res.status(500).json({ error: `Form discovery failed: ${String(err)}` });
  }

  if (formIds.length === 0) {
    return res.status(200).json({ webhookURL: '', total: 0, success: 0, errors: 0, results: [] });
  }

  // Step 2: Register webhook on each form
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const secretParam = WEBHOOK_SECRET ? `?secret=${WEBHOOK_SECRET}` : '';
  const webhookURL = `${proto}://${host}/api/webhook${secretParam}`;

  const results: { formId: string; status: 'ok' | 'error'; detail?: string }[] = [];

  for (const formId of formIds) {
    try {
      const params = new URLSearchParams();
      params.set('webhookURL', webhookURL);

      const response = await fetch(
        `${JOTFORM_BASE}/form/${formId}/webhooks?apiKey=${API_KEY}&teamID=${TEAM_ID}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        }
      );

      if (response.ok) {
        results.push({ formId, status: 'ok' });
      } else {
        const errData = await response.text();
        results.push({ formId, status: 'error', detail: `HTTP ${response.status}: ${errData}` });
      }
    } catch (err) {
      results.push({ formId, status: 'error', detail: String(err) });
    }
  }

  const successCount = results.filter(r => r.status === 'ok').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  return res.status(200).json({
    webhookURL,
    total: formIds.length,
    success: successCount,
    errors: errorCount,
    results,
  });
}
