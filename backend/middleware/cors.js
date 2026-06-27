const cors = require('cors');
const env = require('../config/env');

const origins = env.ALLOWED_ORIGIN.split(',').map(s => s.trim());
const originValue = origins.length === 1 && origins[0] === '*' ? '*' : origins;

module.exports = cors({
  origin: originValue,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-jotform-key-type', 'x-jotform-profile-id'],
});
