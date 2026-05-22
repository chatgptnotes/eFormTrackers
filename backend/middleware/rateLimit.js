const rateLimit = require('express-rate-limit');

// We rely on Express's `trust proxy` setting (configured in server.js) to
// expose the real client IP via req.ip. Using the default key generator
// (req.ip) avoids the well-known X-Forwarded-For spoofing pitfall:
// if a caller controls XFF and we used that header blindly, every request
// could be attributed to a different IP and the limiter would never trip.

const isDev = process.env.NODE_ENV !== 'production';

// Global limiter — generous in dev, tight in prod.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 5000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Auth limiter — protects login/signup/reset-password from credential-stuffing.
// Dev: 200/15min so developers can log in/out repeatedly during work.
// Prod: 20/15min — strict enough to block brute force, lenient enough for
// real users who mistype their password a few times.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 200 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later.' },
});

// Mutation limiter — high-blast-radius POST/PUT/DELETE endpoints
// (delete-submission, workflow-action, etc.).
const mutationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: isDev ? 600 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many mutating requests, slow down.' },
});

module.exports = { globalLimiter, authLimiter, mutationLimiter };
