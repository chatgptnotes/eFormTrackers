const rateLimit = require('express-rate-limit');
const env = require('../config/env');

// We rely on Express's `trust proxy` setting (configured in server.js) to
// expose the real client IP via req.ip. Using the default key generator
// (req.ip) avoids the well-known X-Forwarded-For spoofing pitfall:
// if a caller controls XFF and we used that header blindly, every request
// could be attributed to a different IP and the limiter would never trip.

// Caps are read from .env with testing-friendly defaults so brutal client
// testing isn't throttled. Production can tighten via env vars later. This is
// the SINGLE rate-limit module — the old custom in-memory limiter was deleted.

// Global limiter — coarse cross-cutting cap (before routes).
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.RATE_LIMIT_GLOBAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Auth limiter — protects login/signup/reset-password from credential-stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later.' },
});

// API limiter — the general /api bucket. Skips the read-only signature-proxy
// so heavy signature-image fetching during testing isn't throttled.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.RATE_LIMIT_API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/signature-proxy'),
  message: { error: 'Too many requests, please slow down.' },
});

// Webhook limiter — JotForm webhook ingest.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.RATE_LIMIT_WEBHOOK_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many webhook requests, please slow down.' },
});

// Mutation limiter — high-blast-radius POST/PUT/DELETE endpoints
// (delete-submission, workflow-action, etc.).
const mutationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: env.RATE_LIMIT_MUTATION_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many mutating requests, slow down.' },
});

module.exports = { globalLimiter, authLimiter, apiLimiter, webhookLimiter, mutationLimiter };
