const rateLimit = require('express-rate-limit');
const env = require('../config/env');

// IPv6 validation suppressed — our keyGenerators already normalise IPv6
// (strip ::ffff: prefix, strip port). Adding validate:false here prevents
// the express-rate-limit library from emitting noisy ERR_ERL_KEY_GEN_IPV6
// validation errors on startup.
const VALIDATE = { validate: { keyGeneratorIpFallback: false } };

// IIS ARR forwards X-Forwarded-For as "IP:PORT" — strip the port so
// express-rate-limit doesn't throw ERR_ERL_INVALID_IP_ADDRESS and crash.
const keyGenerator = (req) => {
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ip.replace(/:\d+$/, '').replace(/^::ffff:/, '') || '127.0.0.1';
};

// For authenticated /api routes: key by user email when session is available.
// Corporate offices route all users through a single NAT IP — per-IP keying
// collapses every user into the same bucket and triggers 429 at scale.
const sessionAwareKeyGenerator = (req) => {
  const email = req.session?.user?.email;
  if (email) return email.toLowerCase();
  return keyGenerator(req);
};

// Global limiter — coarse cross-cutting cap (before routes).
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.RATE_LIMIT_GLOBAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  message: { error: 'Too many requests, please try again later.' },
  ...VALIDATE,
});

// Auth limiter — protects login/signup/reset-password from credential-stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  message: { error: 'Too many auth attempts, please try again later.' },
  ...VALIDATE,
});

// API limiter — the general /api bucket. Skips the read-only signature-proxy
// so heavy signature-image fetching during testing isn't throttled.
// Uses session email as key when available (avoids corporate NAT collisions).
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.RATE_LIMIT_API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: sessionAwareKeyGenerator,
  skip: (req) => req.path.startsWith('/signature-proxy'),
  message: { error: 'Too many requests, please slow down.' },
  ...VALIDATE,
});

// Webhook limiter — JotForm webhook ingest.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.RATE_LIMIT_WEBHOOK_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  message: { error: 'Too many webhook requests, please slow down.' },
  ...VALIDATE,
});

// Mutation limiter — high-blast-radius POST/PUT/DELETE endpoints
// (delete-submission, workflow-action, etc.).
const mutationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: env.RATE_LIMIT_MUTATION_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  message: { error: 'Too many mutating requests, slow down.' },
  ...VALIDATE,
});

module.exports = { globalLimiter, authLimiter, apiLimiter, webhookLimiter, mutationLimiter };
