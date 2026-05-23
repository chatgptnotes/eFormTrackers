const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// Only the truly fatal-on-missing vars are required. JOTFORM_API_KEY,
// JOTFORM_WEBHOOK_SECRET, and other JotForm vars are optional — code paths
// that need them check for emptiness at call time and degrade gracefully.
const required = ['DATABASE_URL', 'SESSION_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    // Cannot use the pino logger here because logger.js requires this file.
    // Write directly to stderr; this is a fatal-config path that runs once.
    process.stderr.write(`Missing required env var: ${key}\n`);
    process.exit(1);
  }
}

const jotformBase = process.env.JOTFORM_BASE || 'https://eforms.mediaoffice.ae/API';
if (!jotformBase.startsWith('https://')) {
  console.error('[env] JOTFORM_BASE must use https://');
  process.exit(1);
}

const nodeEnv = process.env.NODE_ENV || 'development';
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
if (nodeEnv === 'production' && allowedOrigin === '*') {
  console.error('[env] ALLOWED_ORIGIN cannot be "*" in production');
  process.exit(1);
}

module.exports = {
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  JOTFORM_API_KEY: process.env.JOTFORM_API_KEY || '',
  JOTFORM_API_KEY_GDMO: process.env.JOTFORM_API_KEY_GDMO || '',
  JOTFORM_TEAM_ID: process.env.JOTFORM_TEAM_ID || '',
  JOTFORM_BASE: jotformBase,
  JOTFORM_HOST: process.env.JOTFORM_HOST || 'https://eforms.mediaoffice.ae',
  JOTFORM_WEBHOOK_SECRET: process.env.JOTFORM_WEBHOOK_SECRET || '',
  ALLOWED_ORIGIN: allowedOrigin,
  PORT: parseInt(process.env.PORT || '3001', 10),
  NODE_ENV: nodeEnv,
  MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID || '',
  MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID || '',
  MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET || '',
  MICROSOFT_REDIRECT_URI: process.env.MICROSOFT_REDIRECT_URI || '',
  ADMIN_EMAIL: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  ADMIN_NAME: process.env.ADMIN_NAME || '',
  POLL_INTERVAL_MINUTES: parseInt(process.env.POLL_INTERVAL_MINUTES || '2', 10),
};
