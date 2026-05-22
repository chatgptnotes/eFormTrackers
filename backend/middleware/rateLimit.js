const rateLimit = require('express-rate-limit');

// We rely on Express's `trust proxy` setting (configured in server.js) to
// expose the real client IP via req.ip. Using the default key generator
// (req.ip) avoids the well-known X-Forwarded-For spoofing pitfall:
// if a caller controls XFF and we used that header blindly, every request
// could be attributed to a different IP and the limiter would never trip.

// Global limiter — 300 requests / 15 min per IP.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Auth limiter — 10 requests / 15 min per IP. Protects login, signup,
// reset-password from credential-stuffing / enumeration brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later.' },
});

// Mutation limiter — 60 requests / 5 min per IP for high-blast-radius
// POST/PUT/DELETE endpoints (delete-submission, workflow-action, etc.).
const mutationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many mutating requests, slow down.' },
});

module.exports = { globalLimiter, authLimiter, mutationLimiter };
