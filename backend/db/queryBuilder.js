/**
 * buildUpdateQuery(updates, allowed, options)
 *
 * Build a parameterised SQL fragment for a dynamic UPDATE. The caller composes
 * the final statement: `UPDATE tbl SET ${sql} WHERE id = $N RETURNING *` and
 * passes `[...params, id]` to pool.query.
 *
 * @param {object} updates  partial body of column->value pairs (e.g. req.body)
 * @param {string[]|Set<string>} allowed  whitelist of column names that may be written
 * @param {object} [options]
 * @param {string[]} [options.jsonColumns]  column names whose value must be JSON.stringify'd
 * @param {number}  [options.startIndex=1]  first $N placeholder index to use
 * @returns {{ sql: string, params: any[], fields: string[] }}
 */
function buildUpdateQuery(updates, allowed, options = {}) {
  const allowedSet = allowed instanceof Set ? allowed : new Set(allowed);
  const jsonSet = new Set(options.jsonColumns || []);
  const startIndex = typeof options.startIndex === 'number' ? options.startIndex : 1;

  const setClauses = [];
  const params = [];
  const fields = [];
  let idx = startIndex;

  for (const [key, val] of Object.entries(updates || {})) {
    if (!allowedSet.has(key)) continue;
    setClauses.push(`${key} = $${idx++}`);
    params.push(jsonSet.has(key) ? JSON.stringify(val) : val);
    fields.push(key);
  }

  return { sql: setClauses.join(', '), params, fields };
}

module.exports = { buildUpdateQuery };
