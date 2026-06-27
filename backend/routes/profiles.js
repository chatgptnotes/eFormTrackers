const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { listProfiles } = require('../lib/profiles');
const { runFullSyncForProfile } = require('../lib/profile-sync');

const router = Router();

// GET /api/profiles — the API profiles the user can switch between.
// Returns NO secrets (never the api key) — only routing metadata for the picker.
router.get('/profiles', requireAuth, (req, res) => {
  const profiles = listProfiles().map(p => ({
    id: p.id,
    label: p.label,
    scope: p.scope,
    default: p.default,
    configured: !!p.apiKey, // whether a key is actually present for this profile
  }));
  res.json({ profiles });
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
