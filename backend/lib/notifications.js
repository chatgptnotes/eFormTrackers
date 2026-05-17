const pool = require('../db/pool');

/**
 * Insert a notification row and emit via Socket.IO (if io is attached).
 */
async function insertNotification(params) {
  const { userEmail, type, title, message, submissionId, formId, data } = params;
  try {
    await pool.query(
      `INSERT INTO notifications (user_email, type, title, message, submission_id, form_id, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userEmail, type, title, message || '', submissionId || null, formId || null, JSON.stringify(data || {})]
    );

    // Emit via Socket.IO if available
    const { emitToUser } = require('./realtime');
    emitToUser(userEmail, 'notification', { type, title, message, submissionId });
  } catch (err) {
    console.warn('[notifications] Insert error:', err.message);
  }
}

module.exports = { insertNotification };
