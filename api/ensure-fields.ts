import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY;
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '';

/**
 * POST /api/ensure-fields?formId=XXX
 *
 * Ensures a form has the required hidden approval status fields.
 * If fields already exist (detected by label match), returns them.
 * If not, creates them via JotForm API and returns the new field IDs.
 *
 * Returns: { fields: { level, statusFieldId, approverFieldId, dateFieldId }[], overallStatusFieldId, created: boolean }
 */

interface FieldResult {
  level: number;
  statusFieldId: string;
  approverFieldId: string;
  dateFieldId: string;
  evaluatorEmailFieldId: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  if (!API_KEY) return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });

  const formId = req.query.formId as string;
  if (!formId) return res.status(400).json({ error: 'formId required' });

  try {
    // Step 1: Fetch existing questions
    const qRes = await fetch(`${JOTFORM_BASE}/form/${formId}/questions?apiKey=${API_KEY}&teamID=${TEAM_ID}`);
    if (!qRes.ok) return res.status(500).json({ error: `Failed to fetch questions: ${qRes.status}` });
    const qData = await qRes.json();
    const questions = qData.content || {};

    // Step 2: Check if status fields already exist
    const existing: Record<number, { s?: string; a?: string; d?: string; e?: string }> = {};
    let overallStatusFieldId: string | null = null;
    let detectedLevelCount = 0; // auto-detect from existing workflow step fields

    for (const [qid, q] of Object.entries(questions)) {
      const qObj = q as { text?: string; name?: string; type?: string };
      const lbl = (qObj.text || qObj.name || '').toLowerCase();

      // Check for level-specific fields
      const lvlMatch = lbl.match(/(?:^|\b)(?:l|level)\s*(\d+)(?:\b|$)/);
      if (lvlMatch) {
        const lvl = parseInt(lvlMatch[1]);
        if (!existing[lvl]) existing[lvl] = {};
        if (lbl.includes('evaluator') && lbl.includes('email') || lbl.includes('approver') && lbl.includes('email')) {
          if (!existing[lvl].e) existing[lvl].e = qid;
        } else if (lbl.includes('status') || lbl.includes('decision') || lbl.includes('approval')) {
          if (!existing[lvl].s) existing[lvl].s = qid;
        } else if (lbl.includes('approver') || lbl.includes('approved by')) {
          if (!existing[lvl].a) existing[lvl].a = qid;
        } else if (lbl.includes('date') || lbl.includes('time')) {
          if (!existing[lvl].d) existing[lvl].d = qid;
        }
        if (lvl > detectedLevelCount) detectedLevelCount = lvl;
      }

      // Detect level count from workflow step dropdowns (e.g. "Level 1 Approval")
      if (qObj.type === 'control_dropdown' && lbl.match(/\b(level|approval|task|step|evaluation)\b/)) {
        const stepLvlMatch = lbl.match(/(?:level|l)\s*(\d+)/);
        if (stepLvlMatch) {
          const lvl = parseInt(stepLvlMatch[1]);
          if (lvl > detectedLevelCount) detectedLevelCount = lvl;
        }
      }

      // Check for overall status
      const hasLevel = /(?:^|\s)(?:l|level|stage)\s*\d+(?:\s|$)/.test(lbl);
      if (!hasLevel && (
        lbl === 'status' || lbl === 'overall status' ||
        lbl === 'final status' || lbl === 'approval status' ||
        (lbl.includes('overall') && lbl.includes('status'))
      )) {
        overallStatusFieldId = qid;
      }
    }

    // Use auto-detected level count, default to 1
    const numLevels = detectedLevelCount || 1;

    // Check if all required fields exist (including evaluator email)
    let allExist = !!overallStatusFieldId;
    for (let lvl = 1; lvl <= numLevels; lvl++) {
      if (!existing[lvl]?.s || !existing[lvl]?.e) { allExist = false; break; }
    }

    if (allExist) {
      // Fields already exist — return them
      const fields: FieldResult[] = [];
      for (let lvl = 1; lvl <= numLevels; lvl++) {
        fields.push({
          level: lvl,
          statusFieldId: existing[lvl].s!,
          approverFieldId: existing[lvl].a || '',
          dateFieldId: existing[lvl].d || '',
          evaluatorEmailFieldId: existing[lvl].e || '',
        });
      }
      return res.status(200).json({ fields, overallStatusFieldId, created: false });
    }

    // Step 3: Create missing fields
    // Build the questions to add
    const questionsToAdd: Record<string, Record<string, string>> = {};
    let idx = 0;

    for (let lvl = 1; lvl <= numLevels; lvl++) {
      if (!existing[lvl]?.s) {
        questionsToAdd[String(idx)] = {
          type: 'control_textbox',
          text: `L${lvl} Status`,
          name: `l${lvl}Status`,
          hidden: 'Yes',
          order: String(900 + lvl * 10),
        };
        idx++;
      }
      if (!existing[lvl]?.a) {
        questionsToAdd[String(idx)] = {
          type: 'control_textbox',
          text: `L${lvl} Approver`,
          name: `l${lvl}Approver`,
          hidden: 'Yes',
          order: String(901 + lvl * 10),
        };
        idx++;
      }
      if (!existing[lvl]?.d) {
        questionsToAdd[String(idx)] = {
          type: 'control_textbox',
          text: `L${lvl} Date`,
          name: `l${lvl}Date`,
          hidden: 'Yes',
          order: String(902 + lvl * 10),
        };
        idx++;
      }
      if (!existing[lvl]?.e) {
        questionsToAdd[String(idx)] = {
          type: 'control_textbox',
          text: `L${lvl} Evaluator Email`,
          name: `l${lvl}EvaluatorEmail`,
          hidden: 'Yes',
          order: String(903 + lvl * 10),
        };
        idx++;
      }
    }

    if (!overallStatusFieldId) {
      questionsToAdd[String(idx)] = {
        type: 'control_textbox',
        text: 'Overall Status',
        name: 'overallStatus',
        hidden: 'Yes',
        order: '999',
      };
      idx++;
    }

    // POST to JotForm to create questions
    const params = new URLSearchParams();
    for (const [i, q] of Object.entries(questionsToAdd)) {
      for (const [key, val] of Object.entries(q)) {
        params.append(`questions[${i}][${key}]`, val);
      }
    }

    const createRes = await fetch(
      `${JOTFORM_BASE}/form/${formId}/questions?apiKey=${API_KEY}&teamID=${TEAM_ID}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      }
    );

    if (!createRes.ok) {
      const errData = await createRes.json().catch(() => ({}));
      return res.status(500).json({
        error: `Failed to create fields: ${createRes.status}`,
        detail: errData,
      });
    }

    const createData = await createRes.json();

    // Step 4: Re-fetch questions to get the new field IDs
    const q2Res = await fetch(`${JOTFORM_BASE}/form/${formId}/questions?apiKey=${API_KEY}&teamID=${TEAM_ID}`);
    const q2Data = await q2Res.json();
    const updatedQuestions = q2Data.content || {};

    // Re-detect fields
    const finalFields: Record<number, { s?: string; a?: string; d?: string; e?: string }> = {};
    let finalOverall: string | null = null;

    for (const [qid, q] of Object.entries(updatedQuestions)) {
      const qObj = q as { text?: string; name?: string };
      const lbl = (qObj.text || qObj.name || '').toLowerCase();
      const lvlMatch = lbl.match(/(?:^|\b)(?:l|level)\s*(\d+)(?:\b|$)/);
      if (lvlMatch) {
        const lvl = parseInt(lvlMatch[1]);
        if (!finalFields[lvl]) finalFields[lvl] = {};
        if (lbl.includes('evaluator') && lbl.includes('email') || lbl.includes('approver') && lbl.includes('email')) {
          if (!finalFields[lvl].e) finalFields[lvl].e = qid;
        } else if (lbl.includes('status')) { if (!finalFields[lvl].s) finalFields[lvl].s = qid; }
        else if (lbl.includes('approver')) { if (!finalFields[lvl].a) finalFields[lvl].a = qid; }
        else if (lbl.includes('date')) { if (!finalFields[lvl].d) finalFields[lvl].d = qid; }
      }
      const hasLevel = /(?:^|\s)(?:l|level|stage)\s*\d+(?:\s|$)/.test(lbl);
      if (!hasLevel && (lbl === 'overall status' || lbl === 'status' || lbl === 'final status')) {
        finalOverall = qid;
      }
    }

    const fields: FieldResult[] = [];
    for (let lvl = 1; lvl <= numLevels; lvl++) {
      fields.push({
        level: lvl,
        statusFieldId: finalFields[lvl]?.s || '',
        approverFieldId: finalFields[lvl]?.a || '',
        dateFieldId: finalFields[lvl]?.d || '',
        evaluatorEmailFieldId: finalFields[lvl]?.e || '',
      });
    }

    return res.status(200).json({
      fields,
      overallStatusFieldId: finalOverall,
      created: true,
      createResponse: createData,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
