const logger = require('../config/logger');

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, _next) {
  const log = req && req.log ? req.log : logger;
  log.error({ err }, '[error]');
  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';
  res.status(status).json({ error: isProd ? 'Internal server error' : (err.message || 'Internal server error') });
};
