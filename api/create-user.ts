import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const ORG_ID = '971589dd-afcb-4a12-8900-47626e4d59cc';

type OrgRole = 'super_admin' | 'admin' | 'approver' | 'viewer';
const VALID_ROLES: OrgRole[] = ['super_admin', 'admin', 'approver', 'viewer'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase config missing' });
  }

  const { email, password, fullName, department, role, creatorEmail } = req.body || {};

  // Only bk@bettroi.com can create users
  if (creatorEmail !== 'bk@bettroi.com') {
    return res.status(403).json({ error: 'Only bk@bettroi.com can create users' });
  }

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const userRole: OrgRole = VALID_ROLES.includes(role) ? role : 'viewer';

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // Step 1: Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName || email.split('@')[0] },
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    const userId = authData.user.id;

    // Step 2: Create profile
    const { error: profileError } = await supabase.from('profiles').insert({
      user_id: userId,
      full_name: fullName || email.split('@')[0],
      department: department || '',
      role: userRole,
      org_id: ORG_ID,
      preferences: { theme: 'dark', language: 'en' },
    });

    if (profileError) {
      console.error('[create-user] Profile insert error:', profileError);
    }

    // Step 3: Create org_member
    const { error: memberError } = await supabase.from('org_members').insert({
      org_id: ORG_ID,
      user_id: userId,
      role: userRole,
    });

    if (memberError) {
      console.error('[create-user] Org member insert error:', memberError);
    }

    return res.status(200).json({
      ok: true,
      user: { id: userId, email, fullName: fullName || email.split('@')[0], role: userRole, department: department || '' },
    });
  } catch (err) {
    console.error('[create-user] Error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create user' });
  }
}
