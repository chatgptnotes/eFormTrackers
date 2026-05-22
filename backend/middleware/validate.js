/**
 * Build an Express middleware that validates a single source on the request
 * (body | query | params) against a zod schema. On failure, returns
 * { error: 'Invalid input', issues: <zod format()> } with HTTP 400.
 *
 * On success, the parsed (and possibly coerced) value is written back to
 * req[source] so downstream handlers see the cleaned data.
 */
function validate(schema, source = 'body') {
  return function validateMiddleware(req, res, next) {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: 'Invalid input',
        issues: result.error.format(),
      });
    }
    req[source] = result.data;
    next();
  };
}

module.exports = { validate };
