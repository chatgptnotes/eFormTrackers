const { Router } = require('express');
const { validateAndConsumeToken } = require('../lib/task-token');
const { resolveApiKey, buildJotformUrl, jotformFetch } = require('../lib/jotform');

const router = Router();

// GET /api/public/complete-task?token=xxx
// No auth required — magic link that completes a workflow_assign_task.
router.get('/complete-task', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send(page('Invalid link', 'No token provided.'));

  let task;
  try {
    task = await validateAndConsumeToken(token);
  } catch {
    return res.status(500).send(page('Error', 'Could not validate token. Please try again.'));
  }

  if (!task) {
    return res.status(410).send(page(
      'Link expired or already used',
      'This task link has already been used or has expired. Contact your administrator for a new link.'
    ));
  }

  const pool = require('../db/pool');
  const reissue = () => pool.query(`UPDATE task_tokens SET used_at = NULL WHERE token = $1`, [token]).catch(() => {});

  try {
    // Get the outcomeID for this task from JotForm (task has a CUSTOM "Complete" outcome).
    let outcomeID = 1; // safe default
    try {
      const subData = await jotformFetch(`submission/${task.submission_id}`, {
        params: { addWorkflowStatus: '1' },
        keyType: 'gdmo',
      });
      const content = subData?.content || subData;
      const instanceId = content?.workflowInstanceID || content?.workflow_instance_id;
      if (instanceId) {
        const instData = await jotformFetch(`workflow/instance/${instanceId}`, { keyType: 'gdmo' });
        const liveTask = (instData?.content?.taskList || []).find(t => String(t.id) === String(task.task_id));
        const outcomes = liveTask?.element?.outcomes || [];
        if (outcomes.length > 0) outcomeID = Number(outcomes[0].outcomeID);
      }
    } catch (_) {
      // use default outcomeID 1
    }

    const url = buildJotformUrl(`workflow/task/${task.task_id}/complete`, 'gdmo');
    const apiRes = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'APIKEY': resolveApiKey('gdmo') },
      body: JSON.stringify({ outcomeID }),
    });
    if (!apiRes.ok) {
      const errText = await apiRes.text();
      throw new Error(`JotForm returned ${apiRes.status}: ${errText}`);
    }
    return res.send(page('Task Completed!', 'Your task has been marked as complete. You can close this tab.'));
  } catch (err) {
    await reissue();
    return res.status(500).send(page('Could not complete task', `Error: ${err.message}. Please try the link again.`));
  }
});

function page(title, body) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    display:flex;align-items:center;justify-content:center;
    min-height:100vh;margin:0;background:#f0f9ff}
  .box{background:#fff;padding:40px 32px;border-radius:16px;
    box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:420px;width:90%;text-align:center}
  h1{color:#0f766e;margin:0 0 12px;font-size:1.5rem}
  p{color:#555;line-height:1.6;margin:0}
  .check{font-size:3rem;margin-bottom:16px}
</style></head>
<body><div class="box">
  <div class="check">${title.includes('Completed') ? '✅' : title.includes('expired') ? '⏳' : '❌'}</div>
  <h1>${title}</h1><p>${body}</p>
</div></body></html>`;
}

module.exports = router;
