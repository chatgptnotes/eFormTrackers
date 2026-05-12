import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://eekudqlzzklhyhwkqvme.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

interface SyncRecord {
  id: string;
  formId: string;
  formTitle: string;
  title: string;
  description: string;
  submitterName: string;
  submitterEmail: string;
  department: string;
  submissionDate: string;
  currentLevel: number | 'completed' | 'rejected';
  status: string;
  priority: string;
  jotformStatus: string;
  pendingApproverName?: string;
  pendingApproverEmail?: string;
  approvalHistory: Array<{
    level: number;
    approverName: string;
    approverEmail?: string;
    status: string;
    date?: string;
  }>;
  answers?: Record<string, string>;
  actionType?: string;
  approvalUrl?: string;
  workflowInstanceId?: string;
}

/**
 * POST /api/sync-to-supabase
 *
 * Accepts a batch of enriched submission records from the frontend
 * and upserts them into Supabase. Called after every dashboard load/refresh
 * so Supabase always mirrors the latest JotForm + workflow data.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  if (!SUPABASE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });
  }

  const records: SyncRecord[] = req.body?.records;
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array is required' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  let upserted = 0;
  let errors = 0;
  const errorDetails: string[] = [];

  // Process in chunks to avoid Supabase payload limits
  const CHUNK_SIZE = 20;
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    const rows = chunk.map(r => {
      const numericLevel = typeof r.currentLevel === 'number' ? r.currentLevel :
        r.currentLevel === 'completed' ? 999 : 0;
      const statusStr = r.currentLevel === 'completed' ? 'completed' :
        r.currentLevel === 'rejected' ? 'rejected' : 'pending';

      return {
        jotform_submission_id: r.id,
        form_id: r.formId,
        form_title: r.formTitle,
        title: r.title,
        description: r.description || r.title,
        submitted_by: r.submitterName,
        submitter_name: r.submitterName,
        submitter_email: r.submitterEmail,
        department: r.department,
        submission_date: r.submissionDate ? new Date(r.submissionDate).toISOString() : new Date().toISOString(),
        current_level: Math.min(numericLevel, 99),
        status: statusStr,
        priority: r.priority || 'medium',
        jotform_status: r.jotformStatus || 'Pending',
        pending_approver_name: r.pendingApproverName || '',
        pending_approver_email: r.pendingApproverEmail || '',
        approver_name: r.pendingApproverName || '',
        approver_email: r.pendingApproverEmail || '',
        answers: r.answers || {},
        level_history: r.approvalHistory || [],
        raw_data: { _mapped: { levels: r.approvalHistory } },
        approval_url: r.approvalUrl || null,
        // workflow_instance_id: r.workflowInstanceId || null, // TODO: Column doesn't exist in schema yet
        last_synced: new Date().toISOString(),
      };
    });

    const { error } = await supabase
      .from('jf_submissions')
      .upsert(rows, { onConflict: 'jotform_submission_id' });

    if (error) {
      console.error('Supabase upsert error:', error.message, error.details, error.hint);
      errorDetails.push(error.message);
      errors += chunk.length;
    } else {
      upserted += chunk.length;
    }
  }

  return res.status(200).json({ ok: true, upserted, errors, total: records.length, errorDetails });
}
