import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY;
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '260541093809054';

// All approval levels require a digital signature
const SIGNATURE_REQUIRED_LEVELS = [1, 2, 3, 4];

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'; // Set to your domain in production

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!API_KEY) {
    return res.status(500).json({ error: 'JOTFORM_API_KEY environment variable is not set' });
  }

  const submissionId = req.query.submissionId as string;
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' });

  try {
    const rawBody = typeof req.body === 'string' ? req.body : new URLSearchParams(req.body as Record<string, string>).toString();
    const params = new URLSearchParams(rawBody);

    // Extract metadata fields (not forwarded to JotForm)
    const action = params.get('_action');       // 'approve' | 'reject'
    const levelStr = params.get('_level');      // e.g. '3'
    const signatureUrl = params.get('_signatureUrl') || '';
    params.delete('_action');
    params.delete('_level');
    params.delete('_signatureUrl');

    // Server-side: block approval at level 3/4 if no signature URL provided
    if (action === 'approve' && levelStr) {
      const level = parseInt(levelStr, 10);
      if (SIGNATURE_REQUIRED_LEVELS.includes(level) && !signatureUrl) {
        return res.status(400).json({ error: `Digital signature is required for Level ${level} approval` });
      }
    }

    const url = `${JOTFORM_BASE}/submission/${submissionId}?apiKey=${API_KEY!}&teamID=${TEAM_ID}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await response.json();
    return res.status(response.ok ? 200 : response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Proxy error', message: String(error) });
  }
}
