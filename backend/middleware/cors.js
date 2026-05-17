const cors = require('cors');
const env = require('../config/env');

const origins = env.ALLOWED_ORIGIN.split(',').map(s => s.trim());

module.exports = cors({
  origin: origins.length === 1 && origins[0] === '*' ? '*' : origins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});
