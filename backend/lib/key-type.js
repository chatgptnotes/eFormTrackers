const { hasProfile, getDefaultProfile } = require('./profiles');

/**
 * Resolve which JotForm profile (api key + base URL + scope) a request targets.
 *
 * Returns a PROFILE ID (consumed by lib/jotform.js). Source order:
 *   1. `x-jotform-profile-id` header / `?profileId` query  (current scheme)
 *   2. legacy `x-jotform-key-type` header / `?keyType` query (gdmo|default)
 *   3. the registry's default profile
 * An id that isn't in the registry falls back to the default, so a stale or
 * bogus header can never point at an unconfigured key.
 */
function readKeyType(req) {
  const v =
    req.headers['x-jotform-profile-id'] || req.query?.profileId ||
    req.headers['x-jotform-key-type'] || req.query?.keyType;
  if (v && hasProfile(String(v))) return String(v);
  return getDefaultProfile().id;
}

module.exports = { readKeyType };
