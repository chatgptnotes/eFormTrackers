const { pollOnce } = require('./poller');
const { runUserSync } = require('./user-sync');
const { runEmailArchive } = require('./email-archiver');
const { getProfile } = require('./profiles');

/**
 * Full ingest for one profile: forms + submissions (+ email_logs + system_logs +
 * enterprise_history + email archive, all driven by the poller) and the user
 * directory. Use after adding a new API profile to config so its data lands in
 * the DB tagged with that profile_id.
 */
async function runFullSyncForProfile(profileId) {
  const profile = getProfile(profileId);
  const id = profile.id; // normalize (falls back to default if unknown)

  // The poller does forms + submissions + the per-profile syncs (system-logs,
  // history, email archive) in one pass; force-run it for this profile.
  await pollOnce({ profileId: id });
  // Users aren't part of the poll loop on a forced single run — sync explicitly.
  await runUserSync({ profileId: id, force: true });
  // Ensure the email archive ran even if the poll throttle skipped it.
  await runEmailArchive({ profileId: id, force: true });

  return { ok: true, profileId: id };
}

module.exports = { runFullSyncForProfile };
