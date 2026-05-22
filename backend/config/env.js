const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const required = ['DATABASE_URL', 'SESSION_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

module.exports = {
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  JOTFORM_API_KEY: process.env.JOTFORM_API_KEY || '',
  JOTFORM_API_KEY_GDMO: process.env.JOTFORM_API_KEY_GDMO || '',
  JOTFORM_TEAM_ID: process.env.JOTFORM_TEAM_ID || '',
  JOTFORM_BASE: process.env.JOTFORM_BASE || 'https://eforms.mediaoffice.ae/API',
  JOTFORM_HOST: process.env.JOTFORM_HOST || 'https://eforms.mediaoffice.ae',
  JOTFORM_WEBHOOK_SECRET: process.env.JOTFORM_WEBHOOK_SECRET || '',
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || 'http://localhost:5173',
  PORT: parseInt(process.env.PORT || '3001', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID || '',
  MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID || '',
  MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET || '',
  MICROSOFT_REDIRECT_URI: process.env.MICROSOFT_REDIRECT_URI || '',
};
