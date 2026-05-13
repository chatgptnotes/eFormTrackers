import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY;
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string;
  joinedAt: string;
  accountType: string;
}

function extractField(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim()) return String(obj[k]);
  }
  return '';
}

function normalizeMember(raw: Record<string, unknown>): TeamMember {
  return {
    id: extractField(raw, 'id', 'user_id', 'userId', 'username'),
    name: extractField(raw, 'name', 'fullName', 'full_name', 'username', 'displayName', 'display_name'),
    email: extractField(raw, 'email', 'userEmail', 'user_email', 'mail'),
    role: extractField(raw, 'role', 'permission', 'accessLevel', 'access_level', 'teamRole', 'team_role'),
    avatarUrl: extractField(raw, 'avatarUrl', 'avatar_url', 'avatar', 'profileImage'),
    joinedAt: extractField(raw, 'created_at', 'createdAt', 'joinedAt', 'joined_at', 'dateJoined'),
    accountType: extractField(raw, 'account_type', 'accountType', 'type', 'userType', 'user_type'),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=300');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!API_KEY) {
    return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });
  }

  const errors: string[] = [];

  // Strategy 1: GET /API/team/{TEAM_ID}/members
  try {
    const url = `${JOTFORM_BASE}/team/${TEAM_ID}/members?apiKey=${API_KEY}&teamID=${TEAM_ID}`;
    console.log('[team-members] Trying:', url.replace(API_KEY, '***'));
    const response = await fetch(url);
    const data = await response.json();
    console.log('[team-members] /team/members status:', response.status, 'keys:', Object.keys(data));

    const raw = Array.isArray(data?.content) ? data.content
              : Array.isArray(data) ? data
              : data?.content ? [data.content]
              : null;

    if (raw && raw.length > 0) {
      console.log('[team-members] First member keys:', Object.keys(raw[0]));
      console.log('[team-members] First member sample:', JSON.stringify(raw[0]).slice(0, 500));
      const members = raw.map((m: Record<string, unknown>) => normalizeMember(m));
      return res.status(200).json({ members, source: 'team_members', rawCount: raw.length });
    }
    errors.push(`/team/members: ${response.status}, content length: ${raw?.length ?? 'null'}`);
  } catch (err) {
    errors.push(`/team/members failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error('[team-members] /team/members error:', err);
  }

  // Strategy 2: GET /API/users
  try {
    const url = `${JOTFORM_BASE}/users?apiKey=${API_KEY}&teamID=${TEAM_ID}`;
    console.log('[team-members] Trying /users fallback');
    const response = await fetch(url);
    const data = await response.json();
    console.log('[team-members] /users status:', response.status, 'keys:', Object.keys(data));

    const raw = Array.isArray(data?.content) ? data.content
              : Array.isArray(data) ? data
              : null;

    if (raw && raw.length > 0) {
      console.log('[team-members] First user keys:', Object.keys(raw[0]));
      console.log('[team-members] First user sample:', JSON.stringify(raw[0]).slice(0, 500));
      const members = raw.map((m: Record<string, unknown>) => normalizeMember(m));
      return res.status(200).json({ members, source: 'users', rawCount: raw.length });
    }
    errors.push(`/users: ${response.status}, content length: ${raw?.length ?? 'null'}`);
  } catch (err) {
    errors.push(`/users failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error('[team-members] /users error:', err);
  }

  // Strategy 3: GET /API/team/user/me (at least show current user's team info)
  try {
    const url = `${JOTFORM_BASE}/team/user/me?apiKey=${API_KEY}&teamID=${TEAM_ID}`;
    console.log('[team-members] Trying /team/user/me fallback');
    const response = await fetch(url);
    const data = await response.json();
    console.log('[team-members] /team/user/me status:', response.status, 'keys:', Object.keys(data));
    console.log('[team-members] /team/user/me content:', JSON.stringify(data?.content || data).slice(0, 1000));

    const content = data?.content;
    if (content) {
      // This might return team list with embedded members
      const teams = Array.isArray(content) ? content : [content];
      const allMembers: TeamMember[] = [];
      for (const team of teams) {
        if (team.members && Array.isArray(team.members)) {
          for (const m of team.members) {
            allMembers.push(normalizeMember(m as Record<string, unknown>));
          }
        }
      }
      if (allMembers.length > 0) {
        return res.status(200).json({ members: allMembers, source: 'team_user_me', rawCount: allMembers.length });
      }
    }
    errors.push(`/team/user/me: ${response.status}`);
  } catch (err) {
    errors.push(`/team/user/me failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return res.status(502).json({
    error: 'Could not fetch team members from any JotForm endpoint',
    details: errors,
    members: [],
  });
}
