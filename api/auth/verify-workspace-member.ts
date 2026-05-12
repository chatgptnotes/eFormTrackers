import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY;
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '260541093809054';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

interface CachedMembers {
  emails: Set<string>;
  members: Map<string, { name: string; email: string; status: string }>;
  fetchedAt: number;
}

let cache: CachedMembers | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchWorkspaceMembers(): Promise<CachedMembers> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;

  const url = `${JOTFORM_BASE}/users?apiKey=${API_KEY}&teamID=${TEAM_ID}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`JotForm API ${response.status}`);
  }
  const data = await response.json();
  const raw: Array<Record<string, unknown>> = Array.isArray(data?.content) ? data.content : [];

  const emails = new Set<string>();
  const members = new Map<string, { name: string; email: string; status: string }>();

  for (const m of raw) {
    const email = String(m.email || '').trim().toLowerCase();
    const status = String(m.status || '').toUpperCase();
    if (!email || status !== 'ACTIVE') continue;
    emails.add(email);
    members.set(email, {
      name: String(m.name || m.username || ''),
      email,
      status,
    });
  }

  cache = { emails, members, fetchedAt: Date.now() };
  return cache;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!API_KEY) {
    return res.status(500).json({ error: 'JOTFORM_API_KEY not set', isMember: false });
  }

  const email = String((req.body?.email || '')).trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: 'email is required', isMember: false });
  }

  try {
    const data = await fetchWorkspaceMembers();
    const isMember = data.emails.has(email);
    const member = isMember ? data.members.get(email) : null;
    return res.status(200).json({ isMember, member, totalMembers: data.emails.size });
  } catch (error) {
    console.error('verify-workspace-member error:', error);
    return res.status(502).json({
      error: 'Failed to verify workspace membership',
      message: String(error),
      isMember: false,
    });
  }
}
