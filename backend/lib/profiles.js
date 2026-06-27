const fs = require('fs');
const path = require('path');
const env = require('../config/env');

/**
 * JotForm API profile registry — makes the app independent of any single key.
 *
 * A *profile* describes one JotForm API to talk to:
 *   { id, label, apiKey, baseUrl, host, scope: 'enterprise'|'user', teamId, default }
 *
 * Profiles are defined in backend/config/jotform-profiles.json (gitignored; see
 * jotform-profiles.example.json). Secrets stay in env — a profile names the env
 * var holding its key via `apiKeyEnv` (or, less ideally, an inline `apiKey`).
 *
 * Scope rules (applied in lib/jotform.js):
 *   - 'enterprise' : rewrite leading `user/` → `enterprise/`, no teamID (org-wide admin key)
 *   - 'user'       : paths as-is, append `teamID` when set (regular account / single team)
 *
 * If no config file exists, the registry is synthesized from the existing env
 * vars so the current single-key deployment keeps working untouched.
 */

const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'jotform-profiles.json');

let cache = null;

function resolveKey(p) {
  if (p.apiKey) return String(p.apiKey);
  if (p.apiKeyEnv) return String(process.env[p.apiKeyEnv] || '');
  return '';
}

function normalize(p) {
  const scope = p.scope === 'user' ? 'user' : 'enterprise';
  return {
    id: String(p.id),
    label: String(p.label || p.id),
    apiKey: resolveKey(p),
    baseUrl: String(p.baseUrl || env.JOTFORM_BASE).replace(/\/$/, ''),
    host: String(p.host || env.JOTFORM_HOST).replace(/\/$/, ''),
    scope,
    teamId: String(p.teamId || ''),
    default: !!p.default,
  };
}

// Build the env-derived registry (backward compat — mirrors the old gdmo/default split).
function fromEnv() {
  const list = [
    {
      id: 'gdmo', label: 'Bettroi Workspace',
      apiKey: env.JOTFORM_API_KEY_GDMO || env.JOTFORM_API_KEY,
      baseUrl: env.JOTFORM_BASE, host: env.JOTFORM_HOST,
      scope: 'user', teamId: env.JOTFORM_TEAM_ID, default: true,
    },
    {
      id: 'default', label: 'Testing',
      apiKey: env.JOTFORM_API_KEY,
      baseUrl: env.JOTFORM_BASE, host: env.JOTFORM_HOST,
      scope: 'user', teamId: env.JOTFORM_TEAM_ID, default: false,
    },
  ];
  return list.map(normalize);
}

function load() {
  if (cache) return cache;
  let profiles = null;
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      const arr = Array.isArray(raw) ? raw : Array.isArray(raw.profiles) ? raw.profiles : null;
      if (arr && arr.length) profiles = arr.filter(p => p && p.id).map(normalize);
    }
  } catch (err) {
    console.error('[profiles] failed to read jotform-profiles.json — falling back to env:', err.message);
  }
  if (!profiles || !profiles.length) profiles = fromEnv();
  // Guarantee exactly one default.
  if (!profiles.some(p => p.default)) profiles[0].default = true;
  cache = profiles;
  return cache;
}

function listProfiles() {
  return load();
}

function getProfile(id) {
  const all = load();
  return all.find(p => p.id === id) || getDefaultProfile();
}

function getDefaultProfile() {
  const all = load();
  return all.find(p => p.default) || all[0];
}

function hasProfile(id) {
  return load().some(p => p.id === id);
}

module.exports = { listProfiles, getProfile, getDefaultProfile, hasProfile };
