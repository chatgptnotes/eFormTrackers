import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY;
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '260541093809054'; // GDMO-Bettroi team
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'; // Set to your domain in production

// Whitelist of query params that may be forwarded to JotForm API
const ALLOWED_PARAMS = new Set(['limit', 'offset', 'orderby', 'direction', 'filter', 'id', 'addWorkflowStatus']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!API_KEY) {
    return res.status(500).json({ error: 'JOTFORM_API_KEY environment variable is not set' });
  }

  // Get the API path from query param
  const apiPath = (req.query.path as string) || 'user/forms';
  const url = new URL(`${JOTFORM_BASE}/${apiPath}`);
  url.searchParams.set('apiKey', API_KEY);

  // Always pass teamID so all requests are scoped to the GDMO-Bettroi team
  url.searchParams.set('teamID', TEAM_ID);

  // Forward only whitelisted query params
  for (const [key, val] of Object.entries(req.query)) {
    if (key !== 'path' && ALLOWED_PARAMS.has(key) && typeof val === 'string') {
      url.searchParams.set(key, val);
    }
  }

  try {
    const response = await fetch(url.toString());
    const data = await response.json();
    return res.status(response.ok ? 200 : response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Proxy error', message: String(error) });
  }
}
