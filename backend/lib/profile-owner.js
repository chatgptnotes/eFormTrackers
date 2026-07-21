const pool = require('../db/pool');
const { jotformFetch } = require('./jotform');

function ownerFrom(data) {
  const raw = Array.isArray(data?.content) ? data.content[0] : data?.content || data || {};
  return {
    username: String(raw.username || raw.user || raw.id || ''),
    name: String(raw.name || raw.fullName || raw.full_name || raw.username || ''),
    email: String(raw.email || raw.userEmail || raw.user_email || ''),
  };
}

async function syncProfileOwner(profileId) {
  const owner = ownerFrom(await jotformFetch('user', { keyType: profileId }));
  await pool.query(
    `INSERT INTO jotform_profile_owners (profile_id, username, name, email, synced_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (profile_id) DO UPDATE SET username=$2, name=$3, email=$4, synced_at=now()`,
    [profileId, owner.username, owner.name, owner.email]
  );
  return owner;
}

module.exports = { ownerFrom, syncProfileOwner };
