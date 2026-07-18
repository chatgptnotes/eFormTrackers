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
const TEAM_PROFILE_MARKER = '__team_';
const NO_TEAM_PROFILE_MARKER = '__all';

let cache = null;

function resolveKey(p) {
  if (p.apiKey) return String(p.apiKey);
  if (p.apiKeyEnv) return String(process.env[p.apiKeyEnv] || process.env.JOTFORM_API_KEY || '');
  return '';
}

function envOrValue(envName, value, fallback) {
  if (envName && process.env[envName]) return String(process.env[envName]);
  if (value) return String(value);
  return fallback;
}

function normalize(p) {
  const scope = p.scope === 'user' ? 'user' : 'enterprise';
  return {
    id: String(p.id),
    label: String(p.label || p.id),
    apiKey: resolveKey(p),
    baseUrl: envOrValue(p.baseUrlEnv, p.baseUrl, env.JOTFORM_BASE).replace(/\/$/, ''),
    host: envOrValue(p.hostEnv, p.host, env.JOTFORM_HOST).replace(/\/$/, ''),
    scope,
    teamId: envOrValue(p.teamIdEnv, p.teamId, env.JOTFORM_TEAM_ID),
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

function parseTeamProfileId(id) {
  const raw = String(id || '');
  const marker = raw.indexOf(TEAM_PROFILE_MARKER);
  if (marker < 0) return null;
  const baseId = raw.slice(0, marker);
  const teamId = raw.slice(marker + TEAM_PROFILE_MARKER.length);
  return baseId && teamId ? { baseId, teamId } : null;
}

function makeTeamProfileId(baseId, teamId) {
  return `${baseId}${TEAM_PROFILE_MARKER}${teamId}`;
}

function parseNoTeamProfileId(id) {
  const raw = String(id || '');
  return raw.endsWith(NO_TEAM_PROFILE_MARKER) ? raw.slice(0, -NO_TEAM_PROFILE_MARKER.length) : null;
}

function makeNoTeamProfileId(baseId) {
  return `${baseId}${NO_TEAM_PROFILE_MARKER}`;
}

function storageProfileId(id) {
  const noTeamBaseId = parseNoTeamProfileId(id);
  return noTeamBaseId || String(id || getDefaultProfile().id);
}

function getProfile(id) {
  const noTeamBaseId = parseNoTeamProfileId(id);
  if (noTeamBaseId) {
    const base = load().find(p => p.id === noTeamBaseId) || getDefaultProfile();
    return { ...base, id: String(id), teamId: '' };
  }
  const team = parseTeamProfileId(id);
  if (team) {
    const base = load().find(p => p.id === team.baseId) || getDefaultProfile();
    return { ...base, id: String(id), teamId: team.teamId };
  }
  const all = load();
  return all.find(p => p.id === id) || getDefaultProfile();
}

function getDefaultProfile() {
  const all = load();
  return all.find(p => p.default) || all[0];
}

function hasProfile(id) {
  const noTeamBaseId = parseNoTeamProfileId(id);
  if (noTeamBaseId) return load().some(p => p.id === noTeamBaseId);
  const team = parseTeamProfileId(id);
  if (team) return load().some(p => p.id === team.baseId);
  return load().some(p => p.id === id);
}

module.exports = { listProfiles, getProfile, getDefaultProfile, hasProfile, makeTeamProfileId, makeNoTeamProfileId, storageProfileId };
