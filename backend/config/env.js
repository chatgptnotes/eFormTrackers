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

const jotformBase = process.env.JOTFORM_BASE || 'https://bettroi.jotform.com/API';
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

const emailForwardTo = (process.env.EMAIL_FORWARD_TO || '').trim().toLowerCase();
const mailSenderAccount = (process.env.MAIL_SENDER_ACCOUNT || emailForwardTo || '').trim().toLowerCase();

module.exports = {
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  JOTFORM_API_KEY: process.env.JOTFORM_API_KEY || '',
  JOTFORM_API_KEY_GDMO: process.env.JOTFORM_API_KEY_GDMO || '',
  JOTFORM_TEAM_ID: process.env.JOTFORM_TEAM_ID || '',
  JOTFORM_BASE: jotformBase,
  JOTFORM_HOST: process.env.JOTFORM_HOST || 'https://bettroi.jotform.com',
  JOTFORM_WEBHOOK_SECRET: process.env.JOTFORM_WEBHOOK_SECRET || '',
  ALLOWED_ORIGIN: allowedOrigin,
  PORT: parseInt(process.env.PORT || '3001', 10),
  NODE_ENV: nodeEnv,
  MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID || '',
  MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID || '',
  MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET || '',
  MICROSOFT_REDIRECT_URI: process.env.MICROSOFT_REDIRECT_URI || '',
  MICROSOFT_REDIRECT_URI_DEV: process.env.MICROSOFT_REDIRECT_URI_DEV || '',
  // Optional: a JotForm browser session cookie (e.g. 'jftoken=xyz...'),
  // used by /api/signature-proxy to fetch /uploads/ files that JotForm
  // protects behind session auth. Obtain from browser DevTools after
  // logging into bettroi.jotform.com as the workspace admin.
  JOTFORM_SESSION_COOKIE: process.env.JOTFORM_SESSION_COOKIE || '',
  EMAIL_FORWARD_ENABLED: process.env.EMAIL_FORWARD_ENABLED === '1',
  EMAIL_FORWARD_TO: emailForwardTo,
  EMAIL_FORWARD_FROM: process.env.EMAIL_FORWARD_FROM || '',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_SECURE: process.env.SMTP_SECURE === '1',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  MAIL_SENDER_ENABLED: process.env.MAIL_SENDER_ENABLED === '1',
  MAIL_SENDER_ACCOUNT: mailSenderAccount,
  MAIL_SENDER_IMAP_HOST: process.env.MAIL_SENDER_IMAP_HOST || 'imap.gmail.com',
  MAIL_SENDER_IMAP_PORT: parseInt(process.env.MAIL_SENDER_IMAP_PORT || '993', 10),
  MAIL_SENDER_IMAP_SECURE: process.env.MAIL_SENDER_IMAP_SECURE !== '0',
  MAIL_SENDER_IMAP_USER: (process.env.MAIL_SENDER_IMAP_USER || mailSenderAccount || '').trim(),
  MAIL_SENDER_IMAP_PASS: process.env.MAIL_SENDER_IMAP_PASS || '',
  MAIL_SENDER_IMAP_ACCESS_TOKEN: process.env.MAIL_SENDER_IMAP_ACCESS_TOKEN || '',
  MAIL_SENDER_IMAP_MAILBOX: process.env.MAIL_SENDER_IMAP_MAILBOX || '[Gmail]/Sent Mail',
  MAIL_SENDER_SYNC_LIMIT: parseInt(process.env.MAIL_SENDER_SYNC_LIMIT || '500', 10),
  MAIL_SENDER_MAX_BYTES: parseInt(process.env.MAIL_SENDER_MAX_BYTES || `${5 * 1024 * 1024}`, 10),
  MAIL_SENDER_SOCKET_TIMEOUT_MS: parseInt(process.env.MAIL_SENDER_SOCKET_TIMEOUT_MS || `${10 * 60 * 1000}`, 10),
  MAIL_SENDER_SENT_SINCE: process.env.MAIL_SENDER_SENT_SINCE || '',
  ADMIN_EMAIL: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  ADMIN_NAME: process.env.ADMIN_NAME || '',
  POLL_INTERVAL_MINUTES: parseFloat(process.env.POLL_INTERVAL_MINUTES || '0.5'),
  // Quick incremental sync between full polls (seconds). 0 disables quick polls.
  POLL_QUICK_SECONDS: parseInt(process.env.POLL_QUICK_SECONDS || '20', 10),
  POLLER_KEY_TYPE: process.env.POLLER_KEY_TYPE || 'gdmo',
  ORG_ID: process.env.ORG_ID || '',
  // M-2: Production-safe rate-limit defaults. Override via env vars if needed.
  // Auth: 15 attempts/15 min. Global: 500/15 min. API: 200/min.
  RATE_LIMIT_GLOBAL_MAX: parseInt(process.env.RATE_LIMIT_GLOBAL_MAX || '1000', 10),
  RATE_LIMIT_API_MAX: parseInt(process.env.RATE_LIMIT_API_MAX || '500', 10),
  RATE_LIMIT_AUTH_MAX: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '15', 10),
  RATE_LIMIT_WEBHOOK_MAX: parseInt(process.env.RATE_LIMIT_WEBHOOK_MAX || '120', 10),
  RATE_LIMIT_MUTATION_MAX: parseInt(process.env.RATE_LIMIT_MUTATION_MAX || '100', 10),
  // H-5: Canonical public URL used when registering JotForm webhooks.
  // Must NOT be derived from the Host request header (user-controlled).
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
};
