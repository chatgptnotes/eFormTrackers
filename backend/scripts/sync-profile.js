/**
 * sync-profile.js — full ingest for one JotForm API profile.
 *
 * After adding a profile to backend/config/jotform-profiles.json (and its key to
 * .env) and restarting, run this to pull that API's forms, submissions, users,
 * and emails into the DB, all tagged with the profile id.
 *
 * Usage (from backend/):
 *   node scripts/sync-profile.js <profileId>
 *   node scripts/sync-profile.js            # lists available profiles
 */
require('dotenv').config();
const { listProfiles, hasProfile } = require('../lib/profiles');

const id = process.argv[2];

if (!id) {
  console.log('Available profiles:');
  for (const p of listProfiles()) {
    console.log(`  ${p.id.padEnd(16)} ${p.label}  [${p.scope}]  key:${p.apiKey ? 'set' : 'MISSING'}${p.default ? '  (default)' : ''}`);
  }
  console.log('\nUsage: node scripts/sync-profile.js <profileId>');
  process.exit(0);
}

if (!hasProfile(id)) {
  console.error(`Unknown profile "${id}". Run with no args to list profiles.`);
  process.exit(1);
}

(async () => {
  const { runFullSyncForProfile } = require('../lib/profile-sync');
  console.log(`Syncing profile "${id}" — forms, submissions, users, emails…`);
  await runFullSyncForProfile(id);
  console.log('Done.');
  process.exit(0);
})().catch(err => { console.error('Fatal:', err); process.exit(1); });
