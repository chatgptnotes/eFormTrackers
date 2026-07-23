const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { listProfiles, getProfile, hasProfile, makeNoTeamProfileId, makeTeamProfileId } = require('../lib/profiles');
const { jotformFetch } = require('../lib/jotform');
const { runFullSyncForProfile } = require('../lib/profile-sync');
const pool = require('../db/pool');

const router = Router();

// GET /api/jotform-profiles — the API profiles the user can switch between.
// Returns NO secrets (never the api key) — only routing metadata for the picker.
function field(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && String(obj[k]).trim()) return String(obj[k]);
  }
  return '';
}

function profilePayload(p) {
  return {
    id: p.id,
    label: p.label,
    scope: p.scope,
    teamId: p.teamId || '',
    default: p.default,
    configured: !!p.apiKey, // whether a key is actually present for this profile
  };
}

function workspaceFromId(id, label, configured = false) {
  const workspaceId = String(id || '');
  const teamMatch = workspaceId.includes('__team_')
    ? workspaceId.slice(workspaceId.indexOf('__team_') + '__team_'.length)
    : '';
  return {
    id: workspaceId,
    label: String(label || workspaceId),
    scope: teamMatch ? 'user' : 'enterprise',
    teamId: teamMatch,
    default: false,
    configured: !!configured,
  };
}

// GET /api/jotform-profiles — include configured profiles plus every JotForm team the
// key can see as a virtual profile: <baseProfile>__team_<teamId>.
router.get('/jotform-profiles', requireAuth, async (req, res) => {
  const configured = listProfiles();
  const byId = new Map(configured.map(p => [p.id, profilePayload(p)]));

  for (const base of configured.filter(p => p.apiKey && p.scope === 'user')) {
    const allId = makeNoTeamProfileId(base.id);
    byId.set(allId, {
      id: allId,
      label: `${base.label} - No workspace filter`,
      scope: base.scope,
      teamId: '',
      default: false,
      configured: true,
    });
    try {
      const data = await jotformFetch('team/user/me', { keyType: base.id });
      const teams = Array.isArray(data?.content) ? data.content : data?.content ? [data.content] : [];
      for (const team of teams) {
        const teamId = field(team, 'id', 'team_id', 'teamId', 'teamID');
        if (!teamId) continue;
        const label = field(team, 'name', 'title', 'teamName', 'team_name') || `Team ${teamId}`;
        const id = makeTeamProfileId(base.id, teamId);
        byId.set(id, {
          id,
          label,
          scope: base.scope,
          teamId,
          default: base.default && base.teamId === teamId,
          configured: true,
        });
      }
    } catch (err) {
      console.warn(`[profiles] team discovery failed for ${base.id}:`, err.message);
    }
  }

  const email = String(req.session.email || '').toLowerCase();
  if (email) {
    const { rows } = await pool.query(
      `SELECT DISTINCT profile_id
         FROM jf_submissions s, jsonb_array_elements(s.workflow_tasks) t
        WHERE lower(t->>'assigneeEmail')=$1 AND t->>'status' IN ('ACTIVE','PENDING')`,
      [email]
    );
    for (const row of rows) {
      if (row.profile_id && hasProfile(row.profile_id) && !byId.has(row.profile_id)) {
        byId.set(row.profile_id, profilePayload(getProfile(row.profile_id)));
      }
    }
  }

  const profiles = [...byId.values()].sort((a, b) => Number(b.default) - Number(a.default) || a.label.localeCompare(b.label));
  res.json({ profiles });
});

// GET /api/admin/workspaces — all workspace ids already present in the DB.
// This is the admin-facing inventory used by the dashboard workspace picker.
router.get('/admin/workspaces', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const configured = listProfiles();
    const byId = new Map(configured.map(p => [p.id, profilePayload(p)]));

    const { rows } = await pool.query(`
      WITH workspace_sources AS (
        SELECT profile_id::text AS workspace_id,
               form_id::text AS form_id,
               NULLIF(title::text, '') AS label,
               updated_at_jf AS updated_at,
               0 AS is_submission
          FROM jf_forms
        UNION ALL
        SELECT profile_id::text AS workspace_id,
               form_id::text AS form_id,
               NULLIF(form_title::text, '') AS label,
               updated_at_jf AS updated_at,
               1 AS is_submission
          FROM jf_submissions
        UNION ALL
        SELECT team_workspace_id::text AS workspace_id,
               form_id::text AS form_id,
               NULLIF(title::text, '') AS label,
               updated_at_jf AS updated_at,
               0 AS is_submission
          FROM team_workspace_forms
      )
      SELECT workspace_id,
             COALESCE(MAX(label) FILTER (WHERE label IS NOT NULL), workspace_id) AS label,
             COUNT(DISTINCT form_id)::int AS form_count,
             COUNT(*) FILTER (WHERE is_submission = 1)::int AS submission_count,
             MAX(updated_at) AS updated_at
        FROM workspace_sources
       WHERE workspace_id IS NOT NULL AND workspace_id <> ''
       GROUP BY workspace_id
       ORDER BY MAX(updated_at) DESC NULLS LAST, workspace_id ASC
    `);

    for (const row of rows) {
      const workspace = workspaceFromId(row.workspace_id, row.label, false);
      byId.set(workspace.id, {
        ...workspace,
        formCount: Number(row.form_count || 0),
        submissionCount: Number(row.submission_count || 0),
        updatedAt: row.updated_at || null,
        source: 'database',
      });
    }

    const profiles = [...byId.values()].sort((a, b) => Number(b.default) - Number(a.default) || a.label.localeCompare(b.label));
    res.json({ profiles });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/profiles/:id/sync — full ingest (forms + submissions + users +
// emails) for one profile. Runs in the background; poll the data endpoints after.
router.post('/admin/profiles/:id/sync', requireAuth, requireRole('admin'), (req, res) => {
  const id = req.params.id;
  // Fire-and-forget — a full sync can take minutes; don't hold the HTTP request.
  runFullSyncForProfile(id).catch(err => console.error(`[profile-sync] ${id} failed:`, err.message));
  res.json({ started: true, profileId: id });
});

module.exports = router;
