const logger = require('../config/logger');

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, _next) {
  const log = req && req.log ? req.log : logger;
  log.error({ err }, '[error]');
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
};
