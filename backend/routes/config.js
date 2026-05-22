const { Router } = require('express');
const pool = require('../db/pool');
const env = require('../config/env');
const { jotformFetch } = require('../lib/jotform');
const { readKeyType } = require('../lib/key-type');
const { requireAuth } = require('../middleware/auth');

const router = Router();

router.use(requireAuth);

// ── GET /api/approver-config?formId=xxx ──
// ── POST /api/approver-config ──
// ── DELETE /api/approver-config?formId=xxx&level=1 ──
router.get('/approver-config', async (req, res, next) => {
  try {
    const formId = req.query.formId;
    let result;
    if (formId) {
      result = await pool.query(
        'SELECT * FROM jf_approver_config WHERE form_id = $1 ORDER BY form_id, level',
        [formId]
      );
    } else {
      result = await pool.query('SELECT * FROM jf_approver_config ORDER BY form_id, level');
    }
    res.json({ configs: result.rows });
  } catch (err) { next(err); }
});

router.post('/approver-config', async (req, res, next) => {
  try {
    const { formId, level, approverName, approverEmail } = req.body || {};
    if (!formId || !level) return res.status(400).json({ error: 'formId and level are required' });

    await pool.query(
      `INSERT INTO jf_approver_config (form_id, level, approver_name, approver_email, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (form_id, level) DO UPDATE SET
         approver_name = $3, approver_email = $4, updated_at = now()`,
      [String(formId), Number(level), String(approverName || ''), String(approverEmail || '')]
    );

    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/approver-config', async (req, res, next) => {
  try {
    const formId = req.query.formId;
    const level = req.query.level;
    if (!formId || !level) return res.status(400).json({ error: 'formId and level are required' });

    await pool.query(
      'DELETE FROM jf_approver_config WHERE form_id = $1 AND level = $2',
      [formId, Number(level)]
    );

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/team-members ──
function extractField(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim()) return String(obj[k]);
  }
  return '';
}

function normalizeMember(raw) {
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

router.get('/team-members', async (req, res) => {
  if (!env.JOTFORM_API_KEY) return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });

  const keyType = readKeyType(req);
  const errors = [];

  // Strategy 1: /team/{TEAM_ID}/members
  try {
    const data = await jotformFetch(`team/${env.JOTFORM_TEAM_ID}/members`, { keyType });
    const raw = Array.isArray(data?.content) ? data.content : data?.content ? [data.content] : null;
    if (raw && raw.length > 0) {
      return res.json({ members: raw.map(normalizeMember), source: 'team_members', rawCount: raw.length });
    }
    errors.push('/team/members: empty');
  } catch (err) {
    errors.push(`/team/members: ${err.message}`);
  }

  // Strategy 2: /users
  try {
    const data = await jotformFetch('users', { keyType });
    const raw = Array.isArray(data?.content) ? data.content : null;
    if (raw && raw.length > 0) {
      return res.json({ members: raw.map(normalizeMember), source: 'users', rawCount: raw.length });
    }
    errors.push('/users: empty');
  } catch (err) {
    errors.push(`/users: ${err.message}`);
  }

  // Strategy 3: /team/user/me
  try {
    const data = await jotformFetch('team/user/me', { keyType });
    const content = data?.content;
    if (content) {
      const teams = Array.isArray(content) ? content : [content];
      const allMembers = [];
      for (const team of teams) {
        if (team.members && Array.isArray(team.members)) {
          for (const m of team.members) allMembers.push(normalizeMember(m));
        }
      }
      if (allMembers.length > 0) {
        return res.json({ members: allMembers, source: 'team_user_me', rawCount: allMembers.length });
      }
    }
    errors.push('/team/user/me: empty');
  } catch (err) {
    errors.push(`/team/user/me: ${err.message}`);
  }

  res.status(502).json({ error: 'Could not fetch team members', details: errors, members: [] });
});

module.exports = router;
