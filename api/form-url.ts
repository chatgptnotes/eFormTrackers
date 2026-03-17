import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_INBOX = 'https://eforms.mediaoffice.ae/inbox';

/**
 * GET /api/form-url?formId={id}&submissionId={id}
 *
 * Returns the correct "View Form" URL for a given submission.
 *
 * JotForm Enterprise does not expose the internal form-fill step URL
 * via any public API in a reliable, per-submission way. The correct
 * destination is the main form's inbox page for that specific submission:
 * /inbox/{formId}/{submissionId}
 *
 * From that inbox page the user sees the submission detail and the native
 * JotForm "View This Form" / form-fill button, which leads to the actual
 * form-fill URL.
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
  // This is the page that shows submission details + the native JotForm
  // "View This Form" button for the form-fill step.
  const formUrl = `${JOTFORM_INBOX}/${formId}/${submissionId}`;

  return res.status(200).json({
    formUrl,
    formId,
    submissionId,
    source: 'inbox',
  });
}
