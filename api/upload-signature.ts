import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://eekudqlzzklhyhwkqvme.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = 'signatures';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const MAX_SIGNATURE_BYTES = 500_000; // ~500KB max for a signature image

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { submissionId, level, signatureData, comment, approverName } = req.body as {
    submissionId: string;
    level: number;
    signatureData: string; // data:image/png;base64,...
    comment?: string;
    approverName?: string;
  };

  if (!submissionId || !level || !signatureData) {
    return res.status(400).json({ error: 'submissionId, level, and signatureData are required' });
  }

  // Validate signature payload size to prevent abuse
  const base64 = signatureData.replace(/^data:image\/\w+;base64,/, '');
  const estimatedBytes = Math.ceil(base64.length * 3 / 4);
  if (estimatedBytes > MAX_SIGNATURE_BYTES) {
    return res.status(413).json({ error: `Signature too large (${Math.round(estimatedBytes / 1024)}KB). Max ${Math.round(MAX_SIGNATURE_BYTES / 1024)}KB.` });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Convert base64 to buffer
    const buffer = Buffer.from(base64, 'base64');
    const storagePath = `${submissionId}/level${level}_${Date.now()}.png`;

    // Ensure the bucket exists (ignore "already exists" error)
    const { error: bucketError } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (bucketError && !bucketError.message.toLowerCase().includes('already exists')) {
      return res.status(500).json({ error: `Bucket error: ${bucketError.message}` });
    }

    // Upload PNG to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType: 'image/png', upsert: true });

    if (uploadError) {
      return res.status(500).json({ error: `Upload error: ${uploadError.message}` });
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    const signatureUrl = urlData.publicUrl;

    // Persist to jf_signatures table
    const { error: dbError } = await supabase.from('jf_signatures').insert({
      submission_id: submissionId,
      level,
      approver_name: approverName || null,
      comment: comment || null,
      signature_url: signatureUrl,
    });

    if (dbError) {
      // Storage succeeded but audit record failed — return URL with warning so
      // the approval can still proceed but the caller knows the audit may be incomplete
      console.error('jf_signatures insert error:', dbError.message);
      return res.status(200).json({ signatureUrl, auditWarning: 'Signature saved but audit record failed: ' + dbError.message });
    }

    return res.status(200).json({ signatureUrl });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
