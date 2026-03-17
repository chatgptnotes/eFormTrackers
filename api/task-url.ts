import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_INBOX = 'https://eforms.mediaoffice.ae/inbox';

/**
 * GET /api/task-url?formId={id}&submissionId={id}
 *
 * Returns the correct "View Task" URL for a given submission.
 *
 * JotForm Enterprise does NOT expose the approval-form task URL
 * (/approval-form/{id}/task/{taskId}/access-token/{token}) via any
 * public API endpoint. That URL is generated internally and sent only
 * via JotForm notification emails.
 *
 * The correct destination is the main form's inbox page for the specific
 * submission: /inbox/{formId}/{submissionId}
 * From that inbox page, the user sees the native JotForm "View Task"
 * button which links to the actual task completion URL.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { formId, submissionId } = req.query as { formId: string; submissionId: string };
  if (!formId || !submissionId) {
    return res.status(400).json({ error: 'formId and submissionId required' });
  }

  // Link directly to the main form's inbox entry for this submission.
  // This is the page that shows submission details + the native "View Task" button.
  const taskUrl = `${JOTFORM_INBOX}/${formId}/${submissionId}`;

  return res.status(200).json({
    taskUrl,
    formId,
    submissionId,
    source: 'inbox',
  });
}
