import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY;
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '260541093809054';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://jot-14march.vercel.app';

/**
 * GET /api/approval-thread?submissionId=12345
 *
 * Proxies to JotForm Enterprise: GET /inbox/submission/{submissionId}/thread
 * Returns the real approval thread with comments, timestamps, and actor details.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!API_KEY) {
    return res.status(500).json({ error: 'JOTFORM_API_KEY environment variable is not set' });
  }

  const submissionId = req.query.submissionId as string;
  if (!submissionId || !/^\d+$/.test(submissionId)) {
    return res.status(400).json({ error: 'submissionId query parameter is required and must be numeric' });
  }

  try {
    const threadUrl = `${JOTFORM_BASE}/inbox/submission/${submissionId}/thread?apiKey=${API_KEY}&teamID=${TEAM_ID}`;
    const threadRes = await fetch(threadUrl);

    if (!threadRes.ok) {
      if (threadRes.status === 404) {
        return res.status(200).json({ thread: [] });
      }
      throw new Error(`JotForm inbox thread API error: ${threadRes.status}`);
    }

    const threadData = await threadRes.json();
    const thread = threadData?.content || threadData?.thread || [];

    return res.status(200).json({ thread: Array.isArray(thread) ? thread : [] });
  } catch (error) {
    console.error('approval-thread error:', error);
    return res.status(500).json({ error: 'Failed to fetch approval thread', message: String(error) });
  }
}
