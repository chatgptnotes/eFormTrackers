const { Router } = require('express');

// Simple in-memory rate limiter — no external dependency needed
// Tracks request counts per IP in a rolling window
const windows = new Map();

function createLimiter(maxRequests, windowMs) {
  return function rateLimiter(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const key = `${ip}:${req.baseUrl}${req.path}`.substring(0, 60);

    if (!windows.has(key)) windows.set(key, []);
    const hits = windows.get(key).filter(t => now - t < windowMs);
    hits.push(now);
    windows.set(key, hits);

    if (hits.length > maxRequests) {
      return res.status(429).json({ error: 'Too many requests, please slow down' });
    }
    next();
  };
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of windows.entries()) {
    if (hits.length === 0 || now - hits[hits.length - 1] > 15 * 60 * 1000) {
      windows.delete(key);
    }
  }
}, 5 * 60 * 1000);

const authLimiter = createLimiter(10, 15 * 60 * 1000);   // 10 req / 15 min
const webhookLimiter = createLimiter(60, 60 * 1000);       // 60 req / min
const apiLimiter = createLimiter(120, 60 * 1000);          // 120 req / min

module.exports = { authLimiter, webhookLimiter, apiLimiter };
