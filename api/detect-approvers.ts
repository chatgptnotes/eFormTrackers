import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY;
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '260541093809054';

// Parse "Action: Approved | By: Name (email) | ..." text
function parseApprover(text: string): { name: string; email: string } | null {
  if (!text) return null;
  const match = text.match(/By:\s*([^(|]+?)\s*\(([^)]+@[^)]+)\)/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  const nameOnly = text.match(/By:\s*([^(|]+?)(?:\s*\||$)/);
  if (nameOnly) return { name: nameOnly[1].trim(), email: '' };
  return null;
}

/**
 * GET /api/detect-approvers?formId=xxx (optional - all forms if omitted)
 * Scans submissions to find who has approved at each level.
 * Returns: { detectedApprovers: [{ formId, level, approverName, approverEmail, count }] }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!API_KEY) return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });

  const targetFormId = req.query.formId as string;

  try {
    // Step 1: Get forms
    let forms: { id: string }[] = [];
    if (targetFormId) {
      forms = [{ id: targetFormId }];
    } else {
      const formsRes = await fetch(`${JOTFORM_BASE}/user/forms?apiKey=${API_KEY}&teamID=${TEAM_ID}&limit=100&status=ENABLED`);
      if (!formsRes.ok) throw new Error(`Forms API error: ${formsRes.status}`);
      const formsData = await formsRes.json();
      forms = (formsData.content || []).map((f: { id: string }) => ({ id: String(f.id) }));
    }

    const detectedApprovers: { formId: string; level: number; approverName: string; approverEmail: string; count: number }[] = [];

    for (const form of forms) {
      // Step 2: Get questions to find approver fields
      const qRes = await fetch(`${JOTFORM_BASE}/form/${form.id}/questions?apiKey=${API_KEY}&teamID=${TEAM_ID}`);
      if (!qRes.ok) continue;
      const qData = await qRes.json();
      const questions = qData.content || {};

      // Find approver fields by label pattern
      const approverFields: { qid: string; level: number }[] = [];
      for (const [qid, q] of Object.entries(questions)) {
        const lbl = ((q as Record<string, unknown>).text || (q as Record<string, unknown>).name || '') as string;
        const lvlMatch = lbl.match(/(?:^|\b)(?:l|level)\s*(\d+)\s*(?:approver|approved\s*by|reviewer)/i);
        if (lvlMatch) {
          approverFields.push({ qid, level: parseInt(lvlMatch[1]) });
        }
      }

      if (approverFields.length === 0) continue;

      // Step 3: Get submissions (last 100)
      const subRes = await fetch(`${JOTFORM_BASE}/form/${form.id}/submissions?apiKey=${API_KEY}&teamID=${TEAM_ID}&limit=100&orderby=created_at&direction=DESC`);
      if (!subRes.ok) continue;
      const subData = await subRes.json();
      const submissions = subData.content || [];

      // Step 4: For each approver field, count who approved
      const approverCounts: Record<string, { name: string; email: string; count: number }> = {};

      for (const sub of submissions) {
        const answers = (sub as Record<string, unknown>).answers as Record<string, Record<string, unknown>> | undefined;
        if (!answers) continue;
        for (const af of approverFields) {
          const answer = answers[af.qid]?.answer;
          if (!answer || typeof answer !== 'string') continue;

          const parsed = parseApprover(answer);
          if (!parsed || !parsed.name) continue;

          const key = `${form.id}:${af.level}:${parsed.email || parsed.name}`;
          if (!approverCounts[key]) {
            approverCounts[key] = { name: parsed.name, email: parsed.email, count: 0 };
          }
          approverCounts[key].count++;
        }
      }

      // Step 5: For each form+level, pick the most common approver
      for (const af of approverFields) {
        const candidates = Object.entries(approverCounts)
          .filter(([k]) => k.startsWith(`${form.id}:${af.level}:`))
          .map(([, v]) => v)
          .sort((a, b) => b.count - a.count);

        if (candidates.length > 0) {
          detectedApprovers.push({
            formId: form.id,
            level: af.level,
            approverName: candidates[0].name,
            approverEmail: candidates[0].email,
            count: candidates[0].count,
          });
        }
      }
    }

    return res.status(200).json({ detectedApprovers });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
