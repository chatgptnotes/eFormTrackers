import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY;

export type StepType = 'approval' | 'task' | 'form';

export interface WorkflowStep {
  level: number;
  type: StepType;
  label: string;
  questionId: string;
  assigneeEmail?: string;
}

/**
 * Manual step-type configuration per form.
 * This overrides keyword auto-detection.
 * Key: formId, Value: map of level → StepType
 *
 * Use this to configure step types for each form without
 * needing to rename questions in JotForm.
 */
/**
 * Per-level assignee email configuration.
 * These emails are shown in the "Pending With" column and used
 * for designated-approver checks in the approval modal.
 *
 * Key: formId, Value: map of level → assignee email
 */
const STEP_ASSIGNEE_CONFIG: Record<string, Record<number, string>> = {
  // ── GDMO-Bettroi Team Forms ────────────────────────────────────────────────
  '260633608278058': { // Proj Completion — 3 levels
    1: 'huzaifa.dawasaz@mediaoffice.ae',
    2: 'bk@bettroi.com',
    3: 'bk@bettroi.com',
  },
  '260633424454050': { // Supplier Rating — 2 levels
    1: 'huzaifa.dawasaz@mediaoffice.ae',
    2: 'bk@bettroi.com',
  },
  '260561554311046': { // Form (generic) — 2 levels
    1: 'huzaifa.dawasaz@mediaoffice.ae',
    2: 'bk@bettroi.com',
  },
  '260561614487865': { // Form demo — Approve & Sign → Form → review Task
    1: 'huzaifa.dawasaz@mediaoffice.ae',
    2: 'bk@bettroi.com',
    3: 'bk@bettroi.com',
  },
  '260703226946458': { // Test Approval Workflow — Sahil → Huzaifa (L1) → Murali BK (L2)
    1: 'huzaifa.dawasaz@mediaoffice.ae',
    2: 'bk@bettroi.com',
  },
  '260702886904463': { // Title Me111 — BK (L1) → BK task (L2) → Huzaifa (L3)
    1: 'bk@bettroi.com',
    2: 'bk@bettroi.com',
    3: 'huzaifa.dawasaz@mediaoffice.ae',
  },
  // ── Legacy / other forms ───────────────────────────────────────────────────
  '260562237554357': { // IT Support Request — 2 levels
    1: 'huzaifa.dawasaz@mediaoffice.ae',
    2: 'bk@bettroi.com',
  },
  '260701439834862': { // Contact Information Collection — 2 levels
    1: 'huzaifa.dawasaz@mediaoffice.ae',
    2: 'bk@bettroi.com',
  },
  '260657596557070': { // Sign Form — 2 levels
    1: 'huzaifa.dawasaz@mediaoffice.ae',
    2: 'bk@bettroi.com',
  },
  '260561840657360': { // Employee Leave Request — 1 level
    1: 'huzaifa.dawasaz@mediaoffice.ae',
  },
  '260561852126354': { // Media Event Planning — 2 levels
    1: 'huzaifa.dawasaz@mediaoffice.ae',
    2: 'bk@bettroi.com',
  },
};

const STEP_TYPE_CONFIG: Record<string, Record<number, StepType>> = {
  // ── GDMO-Bettroi Team Forms (team ID: 260541093809054) ─────────────────────
  '260633608278058': { // Proj Completion
    1: 'approval', 2: 'approval', 3: 'approval',
  },
  '260633424454050': { // Supplier Rating
    1: 'approval', 2: 'approval',
  },
  '260561554311046': { // Form (generic) — 2 levels
    1: 'approval', 2: 'form',
  },
  '260561614487865': { // Form demo — Approve & Sign → Form → review Task
    1: 'approval', 2: 'form', 3: 'task',
  },
  '260703226946458': { // Test Approval Workflow — Sahil → Huzaifa (L1) → Murali BK (L2)
    1: 'approval', 2: 'approval',
  },
  '260702886904463': { // Title Me Form — Submit → BK approve+sign (L1) → BK task (L2) → Huzaifa approve+sign+ViewForm (L3)
    1: 'approval', 2: 'task', 3: 'approval',
  },

  // ── Legacy personal workspace forms (kept for reference) ───────────────────
  // Purchase Order Approval — 4-level workflow
  '260562405560351': {
    1: 'approval',  // Level 1: First reviewer approves the submitted request
    2: 'approval',  // Level 2: Second reviewer approves
    3: 'approval',  // Level 3: Director approves + signs → Review & Sign
    4: 'approval',  // Level 4: Executive final approval + sign → Review & Sign
  },
  // Content Publishing Approval — single level
  '260562114142344': {
    1: 'approval',  // Content publishing: single approval step
  },
  // Task workflow for testing (bk683) — approval then task
  '260673958643066': {
    1: 'approval',  // Step 1: Approval
    2: 'task',      // Step 2: Task → View Task button (links to internal task form)
  },
  // Media Event Planning Request — approval then form submission
  '260561852126354': {
    1: 'approval',  // Step 1: Approval
    2: 'form',      // Step 2: IT Support form submission
  },
  // IT Support Request — now has L1+L2 status fields (Q9-Q15)
  '260562237554357': {
    1: 'approval',
    2: 'approval',
  },
  // Contact Information Collection Form — now has L1+L2 status fields (Q57-Q63)
  '260701439834862': {
    1: 'approval',
    2: 'approval',
  },
  // Sign Form — now has L1+L2 status fields (Q4-Q10)
  '260657596557070': {
    1: 'approval',
    2: 'approval',
  },
  // Blank/template Form — no approval fields yet
  '260658067584064': {
    1: 'form',
  },
  // Employee Leave Request — single-level manager approval
  '260561840657360': {
    1: 'approval',
  },
};

/**
 * Infer step type from question label text.
 *
 * Rules (first match wins):
 *  - "task", "todo", "to-do", "action item", "procurement", "finance", "payment",
 *    "processing", "raise po", "raise order"  → task
 *  - "fill", "complete form", "evaluation", "evaluate", "assessment",
 *    "review form", "submit form"              → form
 *  - anything else (default)                  → approval
 */
function detectStepType(label: string): StepType {
  const t = label.toLowerCase();
  if (/\b(task|todo|to-do|action item|procurement|finance|payment|processing|raise po|raise order)\b/.test(t))
    return 'task';
  if (/\b(fill|complete form|evaluation|evaluate|assessment|review form|submit form)\b/.test(t))
    return 'form';
  return 'approval';
}

// Simple in-process cache (reused across warm invocations of the same Lambda)
const cache: Record<string, { steps: WorkflowStep[]; at: number }> = {};
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const formId = req.query.formId as string;
  if (!formId) return res.status(400).json({ error: 'formId required' });

  // Return cached result if still fresh
  const cached = cache[formId];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.status(200).json({ formId, steps: cached.steps, cached: true });
  }

  // Check manual config override first — skips JotForm API call entirely
  const configuredSteps = STEP_TYPE_CONFIG[formId];
  if (configuredSteps) {
    const assignees = STEP_ASSIGNEE_CONFIG[formId] || {};
    const steps: WorkflowStep[] = Object.entries(configuredSteps).map(([level, type]) => ({
      level: parseInt(level),
      type,
      label: `Level ${level}`,
      questionId: '',
      assigneeEmail: assignees[parseInt(level)] || undefined,
    }));
    cache[formId] = { steps, at: Date.now() };
    return res.status(200).json({ formId, steps, source: 'config' });
  }

  if (!API_KEY) {
    // Return empty steps so the frontend falls back to 'approval' default
    return res.status(200).json({ formId, steps: [], source: 'no-api-key' });
  }

  const TEAM_ID = process.env.JOTFORM_TEAM_ID || '260541093809054';

  try {
    const qRes = await fetch(`${JOTFORM_BASE}/form/${formId}/questions?apiKey=${API_KEY}&teamID=${TEAM_ID}`);
    if (!qRes.ok) return res.status(500).json({ error: `JotForm questions API returned ${qRes.status}` });

    const qData = await qRes.json();
    const questions = (qData.content || {}) as Record<string, {
      type: string;
      text?: string;
      name?: string;
      order?: string;
    }>;

    // Collect dropdown fields whose label looks like a workflow step
    const candidates: Array<{ qid: string; text: string; order: number }> = [];
    for (const [qid, q] of Object.entries(questions)) {
      if (q.type !== 'control_dropdown' || !q.text) continue;
      const t = q.text.toLowerCase();
      // Include if it mentions level/approval/task/step/evaluation/finance/form
      if (/\b(level|approval|task|step|evaluation|finance|form completion|todo)\b/.test(t)) {
        candidates.push({ qid, text: q.text, order: parseInt(q.order || '999') });
      }
    }

    candidates.sort((a, b) => a.order - b.order);

    const steps: WorkflowStep[] = candidates.map((c, i) => ({
      level: i + 1,
      type: detectStepType(c.text),
      label: c.text,
      questionId: c.qid,
    }));

    // ── Auto-detect evaluator emails from submission fields ──
    // Look for "L1 Evaluator Email", "L2 Evaluator Email" etc. in questions
    const evaluatorEmails: Record<number, string> = {};
    for (const [, q] of Object.entries(questions)) {
      const lbl = (q.text || q.name || '').toLowerCase();
      const emailMatch = lbl.match(/^(?:l|level)\s*([1-4])\s+(?:evaluator|approver|reviewer)\s+email$/);
      if (emailMatch) {
        // This field exists — we'll read the email from form properties below
        evaluatorEmails[parseInt(emailMatch[1])] = '';
      }
    }

    // ── Try form properties API for assignee emails ──
    try {
      const propsRes = await fetch(
        `${JOTFORM_BASE}/form/${formId}/properties?apiKey=${API_KEY}&teamID=${TEAM_ID}`
      );
      if (propsRes.ok) {
        const propsData = await propsRes.json();
        const props = propsData.content || {};

        // JotForm stores approval flow info in various property keys
        // Look for approver/assignee email patterns in properties
        const propsStr = JSON.stringify(props);

        // Try to extract emails from flow/conditions/approver properties
        if (props.flow || props.approverEmails || props.conditions) {
          const flowData = props.flow || props.approverEmails || props.conditions;
          const flowStr = typeof flowData === 'string' ? flowData : JSON.stringify(flowData);
          const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
          const emails = flowStr.match(emailPattern) || [];

          // Assign emails to levels in order
          for (let i = 0; i < Math.min(emails.length, steps.length); i++) {
            if (!steps[i].assigneeEmail) {
              steps[i].assigneeEmail = emails[i];
            }
          }
        }

        // Also check for approval widget properties with level-specific emails
        for (const [key, value] of Object.entries(props)) {
          if (typeof value !== 'string') continue;
          // Look for properties like "approver_1_email", "level1_assignee" etc.
          const lvlPropMatch = key.match(/(?:approver|assignee|evaluator)[_\s]*([1-4])/i);
          if (lvlPropMatch) {
            const lvl = parseInt(lvlPropMatch[1]);
            const step = steps.find(s => s.level === lvl);
            if (step && !step.assigneeEmail && value.includes('@')) {
              step.assigneeEmail = value;
            }
          }
        }
      }
    } catch {
      // Properties API failed — non-critical, continue without assignee emails
    }

    cache[formId] = { steps, at: Date.now() };
    return res.status(200).json({ formId, steps });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
