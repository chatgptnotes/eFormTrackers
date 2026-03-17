import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://eekudqlzzklhyhwkqvme.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://jot-14march.vercel.app';

/**
 * GET /api/approver-config              → all configs
 * GET /api/approver-config?formId=xxx   → configs for specific form
 * POST /api/approver-config             → upsert { formId, level, approverName, approverEmail }
 * DELETE /api/approver-config?formId=xxx&level=1 → delete specific config
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  if (req.method === 'GET') {
    const formId = req.query.formId as string;
    let query = supabase.from('jf_approver_config').select('*');
    if (formId) query = query.eq('form_id', formId);
    const { data, error } = await query.order('form_id').order('level');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ configs: data || [] });
  }

  if (req.method === 'POST') {
    const { formId, level, approverName, approverEmail } = req.body || {};
    if (!formId || !level) return res.status(400).json({ error: 'formId and level are required' });

    const { error } = await supabase
      .from('jf_approver_config')
      .upsert({
        form_id: String(formId),
        level: Number(level),
        approver_name: String(approverName || ''),
        approver_email: String(approverEmail || ''),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'form_id,level' });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const formId = req.query.formId as string;
    const level = req.query.level as string;
    if (!formId || !level) return res.status(400).json({ error: 'formId and level are required' });

    const { error } = await supabase
      .from('jf_approver_config')
      .delete()
      .eq('form_id', formId)
      .eq('level', Number(level));

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
