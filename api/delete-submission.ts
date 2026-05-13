import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY;
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const submissionId = req.query.submissionId as string;
  if (!submissionId) return res.status(400).json({ error: 'submissionId is required' });
  if (!API_KEY) return res.status(500).json({ error: 'API key not configured' });

  try {
    const deleteUrl = `${JOTFORM_BASE}/submission/${submissionId}?apiKey=${API_KEY}&teamID=${TEAM_ID}`;
    const deleteRes = await fetch(deleteUrl, { method: 'DELETE' });

    if (deleteRes.ok) {
      console.log(`[delete-submission] Deleted submission ${submissionId}`);
      return res.status(200).json({ success: true, submissionId });
    }

    const errText = await deleteRes.text().catch(() => '');
    console.error(`[delete-submission] Failed to delete ${submissionId}: ${deleteRes.status} ${errText.substring(0, 200)}`);
    return res.status(deleteRes.status).json({ error: `JotForm API error: ${deleteRes.status}` });
  } catch (e) {
    console.error(`[delete-submission] Error:`, e);
    return res.status(500).json({ error: String(e) });
  }
}
