import { useState, useEffect, useCallback, useMemo } from 'react';
import { Submission, ApprovalEntry, ApprovalLevel, FilterConfig, SortConfig, PaginationConfig, RefreshConfig, WorkflowActionType } from '../types';
import { getDashboardStats, getApprovalLevelStats, getDepartmentStats, getTrendData, getBottleneckData, getHeatmapData } from '../services/mockData';
import { supabase } from '../lib/supabase';
import { fetchUserForms, fetchFormQuestions, detectFields, JFFormMeta, DetectedFields } from '../services/formDiscovery';

// ─── Workflow step type cache (per formId) ────────────────────────────────────
interface WorkflowStep { level: number; type: WorkflowActionType; assigneeEmail?: string; }
const workflowCache: Record<string, { steps: WorkflowStep[]; at: number }> = {};
const WORKFLOW_CACHE_TTL = 5 * 60 * 1000; // 5 minutes — re-fetches on each page session

async function fetchWorkflowSteps(formId: string): Promise<WorkflowStep[]> {
  const cached = workflowCache[formId];
  if (cached && Date.now() - cached.at < WORKFLOW_CACHE_TTL) return cached.steps;
  try {
    const res = await fetch(`/api/form-workflow?formId=${formId}`);
    if (!res.ok) return [];
    const data = await res.json();
    const steps: WorkflowStep[] = (data.steps || []).map((s: WorkflowStep & { assigneeEmail?: string }) => ({
      level: s.level,
      type: s.type,
      assigneeEmail: s.assigneeEmail || undefined,
    }));
    workflowCache[formId] = { steps, at: Date.now() };
    return steps;
  } catch {
    return [];
  }
}

// ─── Shared utilities ────────────────────────────────────────────────────────
/** Parse JotForm "YYYY-MM-DD HH:MM:SS" (UTC) or ISO 8601 string into a Date */
function parseUTC(s: string): Date {
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
}

/** Aging thresholds (days) for overallStatus classification */
const AGING_WARN_DAYS = 3;
const AGING_CRITICAL_DAYS = 7;
function agingStatus(days: number): 'on-track' | 'delayed' | 'critical' {
  return days > AGING_CRITICAL_DAYS ? 'critical' : days > AGING_WARN_DAYS ? 'delayed' : 'on-track';
}

// ─── Workspace version — bump when switching teams to force full cache clear ──
const WORKSPACE_VERSION = 'gdmo-bettroi-v3'; // bumped: force cache clear after new Vercel deploy
const WS_VERSION_KEY = 'jotflow_workspace_version';

function checkAndClearWorkspaceCaches() {
  const stored = localStorage.getItem(WS_VERSION_KEY);
  if (stored !== WORKSPACE_VERSION) {
    // Workspace changed — nuke ALL jotflow_* caches so no stale data shows
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('jotflow_')) localStorage.removeItem(k);
    });
    localStorage.setItem(WS_VERSION_KEY, WORKSPACE_VERSION);
    Object.keys(workflowCache).forEach(k => delete workflowCache[k]);
  }
}

// ─── Clear all JotFlow caches (called after any write action) ─────────────────
function clearAllJotFlowCaches() {
  // Clear localStorage caches used by formDiscovery
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('jotflow_')) localStorage.removeItem(k);
  });
  // Clear in-process workflow step cache
  Object.keys(workflowCache).forEach(k => delete workflowCache[k]);
}

function getActionType(steps: WorkflowStep[], currentLevel: number | string): WorkflowActionType {
  if (typeof currentLevel !== 'number') return 'approval';
  const step = steps.find(s => s.level === currentLevel);
  return step?.type ?? 'approval';
}

// ─── Forms we track ───────────────────────────────────────────────────────────
const FORM_ID = '260562405560351';
const FORM_TITLE = 'Purchase Order Approval';

const CONTENT_FORM_ID = '260562114142344';
const CONTENT_FORM_TITLE = 'Content Publishing Approval Request';

const TASK_TEST_FORM_ID = '260673958643066';
const TASK_TEST_FORM_TITLE = 'Task Workflow (Test)';

// Pure submission forms — no approval status fields; always show "Open in JotForm"
const FORM_ONLY_IDS = new Set([
  // IT Support, Contact Info, Sign Form removed — they now have L1/L2 status fields (Mar 12 2026)
  '260658067584064', // Blank/template Form — still no status fields
]);

// ─── Field ID map for form 260562405560351 (Purchase Order) ───────────────────
const FIELD = {
  requesterName: '2', email: '3', department: '4',
  description: '5', amount: '6', priority: '7',
  l1Status: '8', l1Approver: '9', l1Date: '10',
  l2Status: '11', l2Approver: '12', l2Date: '13',
  l3Status: '14', l3Approver: '15', l3Date: '16',
  l4Status: '17', l4Approver: '18', l4Date: '19',
  overallStatus: '20',
} as const;

// ─── Field ID map for form 260562114142344 (Content Publishing) ───────────────
const CP_FIELD = {
  requesterName: '2', email: '3', department: '4',
  contentType: '5', description: '6', priority: '7',
  publishDate: '8', attachments: '9', approvalStatus: '10',
} as const;

// ─── Field extractor ─────────────────────────────────────────────────────────
function extractText(answer: unknown): string {
  if (!answer) return '';
  if (typeof answer === 'string') return answer;
  if (typeof answer === 'number') return String(answer);
  if (Array.isArray(answer)) return answer.filter(Boolean).join(', ');
  if (typeof answer === 'object') {
    const obj = answer as Record<string, string>;
    if (obj.first !== undefined || obj.last !== undefined)
      return [obj.first, obj.last].filter(Boolean).join(' ');
    if (obj.year && obj.month && obj.day)
      return `${obj.year}-${String(obj.month).padStart(2, '0')}-${String(obj.day).padStart(2, '0')}`;
    return Object.values(obj).filter(v => v && typeof v === 'string').join(' ');
  }
  return '';
}

// ─── Map a raw JotForm submission to our Submission model ─────────────────────
function mapJotFormSubmission(raw: Record<string, unknown>, workflowSteps: WorkflowStep[] = []): Submission {
  const answers = (raw.answers as Record<string, { answer: unknown; text?: string }>) || {};
  const get = (id: string) => extractText(answers[id]?.answer);

  const requesterName = get(FIELD.requesterName);
  const email = get(FIELD.email);
  const department = get(FIELD.department) || 'General';
  const description = get(FIELD.description) || FORM_TITLE;
  const amount = get(FIELD.amount);
  const priorityRaw = (get(FIELD.priority) || 'medium').toLowerCase();
  const priority = (['urgent', 'high', 'medium', 'low'].find(p => priorityRaw.includes(p)) || 'medium') as 'low' | 'medium' | 'high' | 'urgent';

  const levelDefs = [
    { level: 1, statusId: FIELD.l1Status, approverNameId: FIELD.l1Approver, dateId: FIELD.l1Date, title: 'Department Head' },
    { level: 2, statusId: FIELD.l2Status, approverNameId: FIELD.l2Approver, dateId: FIELD.l2Date, title: 'Division Manager' },
    { level: 3, statusId: FIELD.l3Status, approverNameId: FIELD.l3Approver, dateId: FIELD.l3Date, title: 'Director' },
    { level: 4, statusId: FIELD.l4Status, approverNameId: FIELD.l4Approver, dateId: FIELD.l4Date, title: 'Executive' },
  ];

  const history: ApprovalEntry[] = [];
  let currentLevel: ApprovalLevel | 'completed' | 'rejected' = 1;

  for (const def of levelDefs) {
    const statusVal = get(def.statusId);
    const approverName = get(def.approverNameId) || def.title;
    const date = get(def.dateId) || undefined;
    const s = statusVal.toLowerCase();

    if (s === 'approved') {
      history.push({ level: def.level as ApprovalLevel, approverName, status: 'approved', date });
      currentLevel = def.level === 4 ? 'completed' : (def.level + 1) as ApprovalLevel;
    } else if (s === 'rejected' || s === 'denied') {
      history.push({ level: def.level as ApprovalLevel, approverName, status: 'rejected', date });
      currentLevel = 'rejected';
      break;
    } else {
      // Pending or blank — stop here
      history.push({ level: def.level as ApprovalLevel, approverName, status: 'pending' });
      currentLevel = def.level as ApprovalLevel;
      break;
    }
  }

  const overallStatus = get(FIELD.overallStatus).toLowerCase();
  if (overallStatus.includes('complet')) currentLevel = 'completed';
  else if (overallStatus.includes('reject')) currentLevel = 'rejected';

  const createdAt = (raw.created_at as string) || '';
  const submissionDate = createdAt ? parseUTC(createdAt) : new Date();
  const totalDays = Math.floor((Date.now() - submissionDate.getTime()) / (1000 * 60 * 60 * 24));

  // Days at current level = time since the last approval date, or since submission if at level 1
  const lastApproval = [...history].reverse().find(h => h.status === 'approved' && h.date);
  const levelStartDate = lastApproval?.date ? parseUTC(lastApproval.date) : submissionDate;
  const daysAtCurrentLevel = Math.floor((Date.now() - levelStartDate.getTime()) / (1000 * 60 * 60 * 24));

  const id = String(raw.id);
  const editLink = String(raw.edit_link || '');
  // For completed/rejected submissions currentLevel is a string — getActionType
  // returns 'approval' for those (non-number), but the modal guards on
  // typeof currentApprovalLevel === 'number', so no action section is shown.
  const actionType = getActionType(workflowSteps, currentLevel);
  // Both taskUrl and formUrl point to the main form's inbox for this submission.
  // From the inbox, JotForm shows the appropriate native action button
  // ("View Task" or "View This Form") depending on the current workflow step.
  const taskUrl = `https://eforms.mediaoffice.ae/inbox/${FORM_ID}/${id}`;
  const formUrl = `https://eforms.mediaoffice.ae/inbox/${FORM_ID}/${id}`;

  const rawOverallStatus = get(FIELD.overallStatus);
  const jotformStatus = rawOverallStatus ||
    (currentLevel === 'completed' ? 'Completed' :
     currentLevel === 'rejected' ? 'Rejected' :
     history.some(h => h.status === 'approved') ? 'In Progress' : 'Pending');

  return {
    id,
    formId: FORM_ID,
    formTitle: FORM_TITLE,
    referenceNumber: `PO-${id.slice(-6)}`,
    title: description,
    description: `${description}${amount ? ' — AED ' + amount : ''}`,
    editLink: editLink || undefined,
    actionType,
    taskUrl,
    formUrl,
    submittedBy: { name: requesterName || 'Unknown', department, email },
    submissionDate: submissionDate.toISOString().slice(0, 10),
    currentApprovalLevel: currentLevel,
    approvalHistory: history,
    daysAtCurrentLevel,
    totalDaysSinceSubmission: totalDays,
    overallStatus: agingStatus(daysAtCurrentLevel),
    jotformStatus,
    priority,
    answers: { description, amount, department, email, requester: requesterName },
  };
}

// ─── Map a raw Content Publishing submission to our Submission model ──────────
function mapContentPublishingSubmission(raw: Record<string, unknown>, workflowSteps: WorkflowStep[] = []): Submission {
  const answers = (raw.answers as Record<string, { answer: unknown; text?: string }>) || {};
  const get = (id: string) => extractText(answers[id]?.answer);

  const requesterName = get(CP_FIELD.requesterName);
  const email = get(CP_FIELD.email);
  const department = get(CP_FIELD.department) || 'General';
  const contentType = get(CP_FIELD.contentType);
  const description = get(CP_FIELD.description) || 'Content Request';
  const priorityRaw = (get(CP_FIELD.priority) || 'medium').toLowerCase();
  const priority = (['urgent', 'high', 'medium', 'low'].find(p => priorityRaw.includes(p)) || 'medium') as 'low' | 'medium' | 'high' | 'urgent';
  const approvalStatus = get(CP_FIELD.approvalStatus).toLowerCase();

  let currentLevel: ApprovalLevel | 'completed' | 'rejected' = 1;
  if (approvalStatus.includes('approved') || approvalStatus.includes('complet')) currentLevel = 'completed';
  else if (approvalStatus.includes('reject') || approvalStatus.includes('denied')) currentLevel = 'rejected';

  const history: ApprovalEntry[] = [{
    level: 1 as ApprovalLevel,
    approverName: 'Content Approver',
    status: currentLevel === 'completed' ? 'approved' : currentLevel === 'rejected' ? 'rejected' : 'pending',
  }];

  const createdAt = (raw.created_at as string) || '';
  const submissionDate = createdAt ? parseUTC(createdAt) : new Date();
  const totalDays = Math.floor((Date.now() - submissionDate.getTime()) / (1000 * 60 * 60 * 24));
  // For pending submissions, daysAtCurrentLevel = totalDays (single-level form).
  // For completed/rejected submissions, they are no longer waiting — use 0 so
  // they don't incorrectly appear as "critical" in the aging column.
  const daysAtCurrentLevel = typeof currentLevel === 'number' ? totalDays : 0;
  const id = String(raw.id);
  const editLink = String(raw.edit_link || '');
  // For completed/rejected submissions getActionType returns 'approval' (non-number
  // currentLevel) — the modal's typeof guard prevents showing action buttons.
  const actionType = getActionType(workflowSteps, currentLevel);
  const taskUrl = `https://eforms.mediaoffice.ae/inbox/${CONTENT_FORM_ID}/${id}`;
  const formUrl = `https://eforms.mediaoffice.ae/inbox/${CONTENT_FORM_ID}/${id}`;

  const rawApprovalStatus = get(CP_FIELD.approvalStatus);
  const cpJotformStatus = rawApprovalStatus ||
    (currentLevel === 'completed' ? 'Completed' :
     currentLevel === 'rejected' ? 'Rejected' : 'Pending');

  return {
    id,
    formId: CONTENT_FORM_ID,
    formTitle: CONTENT_FORM_TITLE,
    referenceNumber: `CP-${id.slice(-6)}`,
    title: `${contentType ? contentType + ' — ' : ''}${description}`,
    description,
    editLink: editLink || undefined,
    actionType,
    taskUrl,
    formUrl,
    submittedBy: { name: requesterName || 'Unknown', department, email },
    submissionDate: submissionDate.toISOString().slice(0, 10),
    currentApprovalLevel: currentLevel,
    approvalHistory: history,
    daysAtCurrentLevel,
    totalDaysSinceSubmission: totalDays,
    overallStatus: agingStatus(daysAtCurrentLevel),
    jotformStatus: cpJotformStatus,
    priority,
    answers: { description, contentType, department, email, requester: requesterName },
  };
}

// ─── Map a raw Task Workflow (Test) submission to our Submission model ────────
// Form 260673958643066 — Level 1: approval, Level 2: task
// Known fields: Q3=Name (fullname), Q4=Email, Q5=File Upload
// No explicit approval-status fields — treat all submissions as pending at level 1
function mapTaskTestSubmission(raw: Record<string, unknown>, workflowSteps: WorkflowStep[] = []): Submission {
  const answers = (raw.answers as Record<string, { answer: unknown; text?: string }>) || {};
  const get = (id: string) => extractText(answers[id]?.answer);

  const requesterName = get('3');
  const email = get('4');
  const department = 'General';

  // Single pending approval history — no status field to read
  const currentLevel: ApprovalLevel | 'completed' | 'rejected' = 1;
  const history: ApprovalEntry[] = [{
    level: 1 as ApprovalLevel,
    approverName: 'Approver',
    status: 'pending',
  }];

  const createdAt = (raw.created_at as string) || '';
  const submissionDate = createdAt ? parseUTC(createdAt) : new Date();
  const totalDays = Math.floor((Date.now() - submissionDate.getTime()) / (1000 * 60 * 60 * 24));
  const daysAtCurrentLevel = totalDays;

  const id = String(raw.id);
  const editLink = String(raw.edit_link || '');
  const actionType = getActionType(workflowSteps, currentLevel);
  const taskUrl = `https://eforms.mediaoffice.ae/inbox/${TASK_TEST_FORM_ID}/${id}`;
  const formUrl = `https://eforms.mediaoffice.ae/inbox/${TASK_TEST_FORM_ID}/${id}`;

  return {
    id,
    formId: TASK_TEST_FORM_ID,
    formTitle: TASK_TEST_FORM_TITLE,
    referenceNumber: `TT-${id.slice(-6)}`,
    title: requesterName ? `Task Request — ${requesterName}` : 'Task Request',
    description: requesterName ? `Task workflow request from ${requesterName}` : 'Task workflow test submission',
    editLink: editLink || undefined,
    actionType,
    taskUrl,
    formUrl,
    submittedBy: { name: requesterName || 'Unknown', department, email },
    submissionDate: submissionDate.toISOString().slice(0, 10),
    currentApprovalLevel: currentLevel,
    approvalHistory: history,
    daysAtCurrentLevel,
    totalDaysSinceSubmission: totalDays,
    overallStatus: agingStatus(daysAtCurrentLevel),
    jotformStatus: 'Pending',
    priority: 'medium',
    answers: { description: '', department, email, requester: requesterName },
  };
}

// ─── Map any JotForm submission using heuristically-detected fields ───────────
function mapGenericSubmission(
  raw: Record<string, unknown>,
  formId: string,
  formTitle: string,
  fields: DetectedFields,
  workflowSteps: WorkflowStep[] = []
): Submission {
  const answers = (raw.answers as Record<string, { answer: unknown; text?: string }>) || {};
  const get = (id: string | null) => id ? extractText(answers[id]?.answer) : '';

  const requesterName = get(fields.nameFieldId);
  const email = get(fields.emailFieldId);
  const department = get(fields.deptFieldId) || 'General';
  const description = get(fields.descFieldId) || formTitle;
  const amount = get(fields.amountFieldId);
  const priorityRaw = (get(fields.priorityFieldId) || 'medium').toLowerCase();
  const priority = (['urgent', 'high', 'medium', 'low'].find(p => priorityRaw.includes(p)) || 'medium') as 'low' | 'medium' | 'high' | 'urgent';

  const history: ApprovalEntry[] = [];
  let currentLevel: ApprovalLevel | 'completed' | 'rejected' = 1 as ApprovalLevel;

  // Evaluator email from submission answers — single or per-level
  const evaluatorEmail = fields.evaluatorEmailFieldId ? get(fields.evaluatorEmailFieldId) : '';
  const getEvaluatorEmail = (level: number): string => {
    const perLevelFieldId = fields.evaluatorEmailsByLevel?.[level];
    if (perLevelFieldId) return get(perLevelFieldId);
    return evaluatorEmail; // fallback to single evaluator email
  };
  // Assignee email from workflow step configuration (set in form-workflow API)
  const getStepAssignee = (level: number): string => {
    const step = workflowSteps.find(s => s.level === level);
    return step?.assigneeEmail || '';
  };

  if (fields.levelFields.length > 0) {
    for (const lf of fields.levelFields) {
      const statusVal = get(lf.statusFieldId).toLowerCase();
      // Use per-level evaluator email, then approver field, then workflow step assignee, then fallback
      const approverName = get(lf.approverFieldId) || getEvaluatorEmail(lf.level) || getStepAssignee(lf.level) || `Level ${lf.level} Approver`;
      const date = get(lf.dateFieldId) || undefined;
      if (statusVal === 'approved') {
        history.push({ level: lf.level as ApprovalLevel, approverName, status: 'approved', date });
        const isLast = lf.level === fields.levelFields[fields.levelFields.length - 1].level;
        currentLevel = isLast ? 'completed' : (lf.level + 1) as ApprovalLevel;
      } else if (statusVal === 'rejected' || statusVal === 'denied') {
        history.push({ level: lf.level as ApprovalLevel, approverName, status: 'rejected', date });
        currentLevel = 'rejected';
        break;
      } else {
        history.push({ level: lf.level as ApprovalLevel, approverName, status: 'pending' });
        currentLevel = lf.level as ApprovalLevel;
        break;
      }
    }
  } else {
    // Single-level: read overall status field
    const overall = get(fields.overallStatusFieldId).toLowerCase();
    if (overall.includes('approved') || overall.includes('complet')) currentLevel = 'completed';
    else if (overall.includes('reject') || overall.includes('denied')) currentLevel = 'rejected';
    else currentLevel = 1 as ApprovalLevel;

    const histStatus = typeof currentLevel === 'number' ? 'pending' : currentLevel === 'completed' ? 'approved' : 'rejected';
    history.push({ level: 1 as ApprovalLevel, approverName: evaluatorEmail || getStepAssignee(1) || 'Approver', status: histStatus });
  }

  // Overall status field can override level computation
  const overallFinal = get(fields.overallStatusFieldId).toLowerCase();
  if (overallFinal.includes('complet')) currentLevel = 'completed';
  else if (overallFinal.includes('reject')) currentLevel = 'rejected';

  // Detect native JotForm approval: ALL hidden fields blank but submission was acted upon.
  // If ANY level field has been filled (e.g. L1 = "Approved"), it means someone already
  // acted through JotFlow — no sync needed even if later levels are still blank.
  let needsSync = false;
  if (typeof currentLevel === 'number') {
    const allLevelFieldsEmpty = fields.levelFields.length > 0
      ? fields.levelFields.every(lf => !get(lf.statusFieldId))
      : !get(fields.overallStatusFieldId);

    if (allLevelFieldsEmpty) {
      const currentEntry = history.find(h => h.level === currentLevel && h.status === 'pending');
      if (currentEntry) {
        const rawCreated = String(raw.created_at || '');
        const rawUpdated = String(raw.updated_at || '');
        const isViewed = String((raw as Record<string, unknown>).new) === '0';

        if (rawCreated && rawUpdated && rawCreated !== rawUpdated && isViewed) {
          const createdMs = new Date(rawCreated.replace(' ', 'T') + 'Z').getTime();
          const updatedMs = new Date(rawUpdated.replace(' ', 'T') + 'Z').getTime();
          if ((updatedMs - createdMs) > 60000) {
            needsSync = true;
          }
        }
      }
    }
  }

  const createdAt = (raw.created_at as string) || '';
  const submissionDate = createdAt ? parseUTC(createdAt) : new Date();
  const totalDays = Math.floor((Date.now() - submissionDate.getTime()) / (1000 * 60 * 60 * 24));

  const lastApproval = [...history].reverse().find(h => h.status === 'approved' && h.date);
  const levelStartDate = lastApproval?.date ? parseUTC(lastApproval.date) : submissionDate;
  const daysAtCurrentLevel = typeof currentLevel === 'number'
    ? Math.floor((Date.now() - levelStartDate.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const id = String(raw.id);
  const editLink = String(raw.edit_link || '');
  const actionType = getActionType(workflowSteps, currentLevel);
  const inboxUrl = `https://eforms.mediaoffice.ae/inbox/${formId}/${id}`;
  const prefix = formTitle.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 3) || 'WF';

  const rawGenericStatus = get(fields.overallStatusFieldId);
  const genericJotformStatus = rawGenericStatus ||
    (currentLevel === 'completed' ? 'Completed' :
     currentLevel === 'rejected' ? 'Rejected' :
     history.some(h => h.status === 'approved') ? 'In Progress' : 'Pending');

  return {
    id,
    formId,
    formTitle,
    referenceNumber: `${prefix}-${id.slice(-6)}`,
    title: description,
    description: `${description}${amount ? ' — AED ' + amount : ''}`,
    editLink: editLink || undefined,
    actionType,
    taskUrl: inboxUrl,
    formUrl: inboxUrl,
    submittedBy: { name: requesterName || 'Unknown', department, email },
    submissionDate: submissionDate.toISOString().slice(0, 10),
    currentApprovalLevel: currentLevel,
    approvalHistory: history,
    daysAtCurrentLevel,
    totalDaysSinceSubmission: totalDays,
    overallStatus: agingStatus(daysAtCurrentLevel),
    jotformStatus: genericJotformStatus,
    priority,
    answers: { description, amount, department, email, requester: requesterName },
    levelFieldMap: fields.levelFields.length > 0
      ? fields.levelFields.map(lf => ({
          level: lf.level,
          statusFieldId: lf.statusFieldId,
          approverFieldId: lf.approverFieldId,
          overallStatusFieldId: fields.overallStatusFieldId,
        }))
      : fields.overallStatusFieldId
        ? [{ level: 1, statusFieldId: fields.overallStatusFieldId, approverFieldId: null, overallStatusFieldId: fields.overallStatusFieldId }]
        : undefined,
    needsSync,
  };
}

// ─── Map a Supabase row back to a Submission ──────────────────────────────────
function mapSupabaseRow(row: Record<string, unknown>): Submission {
  const raw = (row.raw_data as Record<string, unknown>) || {};

  // If raw_data has the full JotForm answers, use them
  if (raw.answers) {
    return mapJotFormSubmission({ ...raw, id: row.jotform_submission_id });
  }

  // Fallback: use the pre-mapped fields from Supabase
  const mapped = (raw._mapped as Record<string, unknown>) || {};
  const levels = (mapped.levels as Array<{ id: number; status: string; approver: string; date?: string }>) || [];
  const history: ApprovalEntry[] = levels.map(l => ({
    level: l.id as ApprovalLevel,
    approverName: l.approver || `Level ${l.id} Approver`,
    status: (l.status?.toLowerCase() === 'approved' ? 'approved' : l.status?.toLowerCase() === 'rejected' ? 'rejected' : 'pending') as 'approved' | 'rejected' | 'pending',
    date: l.date || undefined,
  }));

  const totalDays = Number(row.total_days) || 0;
  const status = String(row.status || 'pending');
  const currentLevel: ApprovalLevel | 'completed' | 'rejected' =
    status === 'completed' ? 'completed' : status === 'rejected' ? 'rejected' : (Number(row.current_level) || 1) as ApprovalLevel;

  const sbId = String(row.jotform_submission_id);
  const sbFormId = String(row.form_id || FORM_ID);

  return {
    id: sbId,
    formId: sbFormId,
    formTitle: FORM_TITLE,
    referenceNumber: `PO-${sbId.slice(-6)}`,
    title: String(row.title || 'Purchase Order'),
    description: String(row.title || 'Purchase Order'),
    actionType: 'approval' as WorkflowActionType,
    taskUrl: `https://eforms.mediaoffice.ae/inbox/${sbFormId}/${sbId}`,
    formUrl: `https://eforms.mediaoffice.ae/inbox/${sbFormId}/${sbId}`,
    submittedBy: {
      name: String(row.submitted_by || 'Unknown'),
      department: String(row.department || 'General'),
      email: String((mapped.email as string) || ''),
    },
    submissionDate: String(row.submission_date || new Date().toISOString()).slice(0, 10),
    currentApprovalLevel: currentLevel,
    approvalHistory: history,
    daysAtCurrentLevel: totalDays,
    totalDaysSinceSubmission: totalDays,
    overallStatus: agingStatus(totalDays),
    jotformStatus: String(row.status || (currentLevel === 'completed' ? 'Completed' : currentLevel === 'rejected' ? 'Rejected' : 'Pending')),
    priority: 'medium',
    answers: { description: String(row.title || ''), amount: String((mapped.amount as string) || ''), department: String(row.department || ''), email: String((mapped.email as string) || ''), requester: String(row.submitted_by || '') },
  } as Submission;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSubmissions() {
  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);
  const [activeForms, setActiveForms] = useState<JFFormMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshConfig, setRefreshConfig] = useState<RefreshConfig>({
    autoRefresh: true,
    intervalMinutes: 1,
    lastUpdated: null,
  });

  const [filters, setFilters] = useState<FilterConfig>(() => {
    try {
      const saved = localStorage.getItem('jotflow_filters');
      return saved ? { ...{ approvalLevel: '', department: '', status: '', dateFrom: '', dateTo: '', search: '' }, ...JSON.parse(saved) } : { approvalLevel: '', department: '', status: '', dateFrom: '', dateTo: '', search: '' };
    } catch { return { approvalLevel: '', department: '', status: '', dateFrom: '', dateTo: '', search: '' }; }
  });
  const wrappedSetFilters = (updater: FilterConfig | ((prev: FilterConfig) => FilterConfig)) => {
    setFilters(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('jotflow_filters', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const [sort, setSort] = useState<SortConfig>({ key: 'submissionDate', direction: 'desc' });
  const [pagination, setPagination] = useState<PaginationConfig>({ page: 1, perPage: 25, total: 0 });

  const loadData = useCallback(async (opts?: { force?: boolean }) => {
    const force = opts?.force ?? false;
    // Always check workspace version on load — clears stale caches if team changed
    checkAndClearWorkspaceCaches();
    // If force-refreshing after a write action, bust all caches first
    if (force) clearAllJotFlowCaches();

    setLoading(true);
    setError(null);

    // ── Skip stale Supabase Phase 1 — go straight to fresh JotForm data ──────
    // Showing stale cached data first causes a visible flicker when workspace
    // changed or Supabase is out-of-date. We wait for live data instead.
    const hasCachedData = false;

    // ── Fetch all forms + submissions fresh from JotForm ─────────────────────
    try {
      fetch('/api/sync').catch(err => console.warn('[JotFlow] Sync failed:', err));

      // Discover all enabled JotForm workflows for this account
      const forms = await fetchUserForms();
      // Don't setActiveForms yet — wait until submissions are ready to avoid mid-load flicker

      // Fetch submissions + questions for all forms in parallel
      let partialDataWarning = false;
      const formResults = await Promise.all(
        forms.map(async (form) => {
          const questions = await fetchFormQuestions(form.id);

          // Fetch ALL submissions with pagination (JotForm caps at 1000 per request)
          const pageLimit = 1000;
          const maxPages = 10; // Safety cap to prevent runaway loops
          let offset = 0;
          let pageCount = 0;
          const rows: Record<string, unknown>[] = [];
          while (pageCount < maxPages) {
            const res = await fetch(
              `/api/jotform?path=form/${form.id}/submissions&limit=${pageLimit}&offset=${offset}&orderby=created_at&direction=DESC`
            );
            if (!res.ok) {
              console.warn(`[JotFlow] Failed to fetch submissions for form ${form.id} (offset=${offset}, status=${res.status})`);
              if (rows.length > 0) partialDataWarning = true;
              break;
            }
            const data = await res.json();
            const page: Record<string, unknown>[] = data?.content || [];
            rows.push(...page);
            if (page.length < pageLimit) break;
            offset += pageLimit;
            pageCount++;
          }
          const detectedFields = detectFields(questions);
          const steps = await fetchWorkflowSteps(form.id);
          return { form, rows, detectedFields, steps };
        })
      );

      const totalRows = formResults.reduce((sum, r) => sum + r.rows.length, 0);

      if (totalRows > 0) {
        const mapped: Submission[] = [];
        const newStepsByForm: Record<string, WorkflowStep[]> = {};
        for (const { form, rows, detectedFields, steps } of formResults) {
          newStepsByForm[form.id] = steps;
          for (const raw of rows) {
            // All forms from GDMO-Bettroi team use the generic mapper (auto field detection)
            mapped.push(mapGenericSubmission(raw, form.id, form.title, detectedFields, steps));
          }
        }
        // Batch state updates together — prevents double render / flicker
        setStepsByForm(newStepsByForm);
        setActiveForms(forms);
        setAllSubmissions(mapped);
        setRefreshConfig(prev => ({ ...prev, lastUpdated: new Date().toISOString() }));
        if (partialDataWarning) {
          setError('Some submissions could not be loaded — showing partial data');
        }
      } else if (forms.length === 0 && !hasCachedData) {
        setError('No JotForm workflows found. Please ensure your JotForm account has enabled forms.');
      } else if (totalRows === 0 && !hasCachedData) {
        setError('Live data unavailable — showing cached data');
      }
    } catch (err: unknown) {
      if (!hasCachedData) {
        setError(err instanceof Error ? err.message : String(err));
        setAllSubmissions([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Supabase real-time subscription — re-fetch when needs_sync rows appear
  useEffect(() => {
    const channel = supabase
      .channel('jf_sync_needed')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jf_submissions',
        filter: 'needs_sync=eq.true',
      }, () => {
        loadData();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  // Auto-refresh (1 min fallback if webhooks fail)
  useEffect(() => {
    if (!refreshConfig.autoRefresh) return;
    const interval = setInterval(loadData, refreshConfig.intervalMinutes * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshConfig.autoRefresh, refreshConfig.intervalMinutes, loadData]);

  // ─── Filtering / sorting / pagination ─────────────────────────────────────
  const filteredSubmissions = useMemo(() => {
    let result = [...allSubmissions];
    if (filters.approvalLevel) {
      const level = filters.approvalLevel === 'completed' ? 'completed'
        : filters.approvalLevel === 'rejected' ? 'rejected'
        : Number(filters.approvalLevel);
      result = result.filter(s => s.currentApprovalLevel === level);
    }
    if (filters.department) result = result.filter(s => s.submittedBy.department === filters.department);
    if (filters.status) result = result.filter(s => s.jotformStatus?.toLowerCase().includes(filters.status.toLowerCase()));
    if (filters.dateFrom) result = result.filter(s => s.submissionDate >= filters.dateFrom);
    if (filters.dateTo) result = result.filter(s => s.submissionDate <= filters.dateTo);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.referenceNumber.toLowerCase().includes(q) ||
        s.submittedBy.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.formId.toLowerCase().includes(q) ||
        s.formTitle.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sort.key];
      const bVal = (b as unknown as Record<string, unknown>)[sort.key];
      const cmp = String(aVal || '').localeCompare(String(bVal || ''), undefined, { numeric: true });
      return sort.direction === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [allSubmissions, filters, sort]);

  useEffect(() => {
    setPagination(prev => ({ ...prev, total: filteredSubmissions.length, page: 1 }));
  }, [filteredSubmissions.length]);

  const paginatedSubmissions = useMemo(() => {
    const start = (pagination.page - 1) * pagination.perPage;
    return filteredSubmissions.slice(start, start + pagination.perPage);
  }, [filteredSubmissions, pagination.page, pagination.perPage]);

  const stats = useMemo(() => getDashboardStats(allSubmissions), [allSubmissions]);
  const approvalStats = useMemo(() => getApprovalLevelStats(allSubmissions), [allSubmissions]);
  const departmentStats = useMemo(() => getDepartmentStats(allSubmissions), [allSubmissions]);
  const trendData = useMemo(() => getTrendData(allSubmissions), [allSubmissions]);
  const bottleneckData = useMemo(() => getBottleneckData(allSubmissions), [allSubmissions]);
  const heatmapData = useMemo(() => getHeatmapData(allSubmissions), [allSubmissions]);

  // ─── Workflow step cache (for optimistic updates) ─────────────────────────
  // Populated during loadData — maps formId → steps so optimistic updates
  // can resolve the next-level assignee email.
  const [stepsByForm, setStepsByForm] = useState<Record<string, WorkflowStep[]>>({});

  // ─── Optimistic update: immediately patch a submission in state ─────────────
  // Call this right after a successful write to JotForm so the UI reflects
  // the new status instantly, without waiting for the next full re-fetch.
  const optimisticUpdate = useCallback((
    submissionId: string,
    patch: {
      newLevel?: ApprovalLevel | 'completed' | 'rejected';
      newJotformStatus?: string;
      approverName?: string;
      approvalDate?: string;
    }
  ) => {
    setAllSubmissions(prev => prev.map(sub => {
      if (sub.id !== submissionId) return sub;

      const updatedHistory = [...sub.approvalHistory];
      const currentLvl = sub.currentApprovalLevel;

      if (patch.newLevel !== undefined && typeof currentLvl === 'number') {
        // Mark the current level as approved/rejected in history
        const histIdx = updatedHistory.findIndex(h => h.level === currentLvl);
        const isRejected = patch.newLevel === 'rejected';
        const entry = {
          level: currentLvl as ApprovalLevel,
          approverName: patch.approverName || updatedHistory[histIdx]?.approverName || `Level ${currentLvl} Approver`,
          status: (isRejected ? 'rejected' : 'approved') as 'approved' | 'rejected' | 'pending',
          date: patch.approvalDate || new Date().toISOString().slice(0, 10),
        };
        if (histIdx >= 0) updatedHistory[histIdx] = entry;
        else updatedHistory.push(entry);

        // Add pending entry for next level (if approved and not completed)
        if (!isRejected && patch.newLevel !== 'completed' && typeof patch.newLevel === 'number') {
          const nextLvl = patch.newLevel as ApprovalLevel;
          const nextExists = updatedHistory.findIndex(h => h.level === nextLvl);
          // Resolve next-level approver from workflow step config
          const formSteps = stepsByForm[sub.formId] || [];
          const nextStep = formSteps.find(s => s.level === nextLvl);
          const nextApprover = nextStep?.assigneeEmail || `Level ${nextLvl} Approver`;
          if (nextExists < 0) updatedHistory.push({ level: nextLvl, approverName: nextApprover, status: 'pending' });
        }
      }

      return {
        ...sub,
        currentApprovalLevel: patch.newLevel ?? sub.currentApprovalLevel,
        jotformStatus: patch.newJotformStatus ?? sub.jotformStatus,
        approvalHistory: updatedHistory,
        daysAtCurrentLevel: 0, // reset — just actioned
      };
    }));
  }, [stepsByForm]);

  return {
    allSubmissions, filteredSubmissions, paginatedSubmissions,
    activeForms,
    loading, error,
    stats, approvalStats, departmentStats, trendData, bottleneckData, heatmapData,
    filters, setFilters: wrappedSetFilters,
    sort, setSort,
    pagination, setPagination,
    refreshConfig, setRefreshConfig,
    refresh: loadData,
    optimisticUpdate,
  };
}
