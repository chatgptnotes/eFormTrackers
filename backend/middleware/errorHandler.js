// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, _next) {
  console.error('[error]', err.stack || err.message || err);
  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';
  res.status(status).json({ error: isProd ? 'Internal server error' : (err.message || 'Internal server error') });
};
