/**
 * submissionMappers.ts
 *
 * Pure mapping functions that turn raw API data into Submission objects.
 *
 * Two entry points:
 *   - mapGenericSubmission: JotForm bulk submissions API → Submission
 *   - mapSupabaseRow:       jf_submissions Supabase row     → Submission
 *
 * Both call enrichApproverInfo() (F3) to resolve the displayed approver name
 * and email from the same priority chain (parsed action text → config →
 * workflow API → form field → fallback).
 */
import {
  Submission,
  ApprovalEntry,
  ApprovalLevel,
  WorkflowActionType,
} from '../types';
import { DetectedFields } from '../services/formDiscovery';
import { WorkflowStep, WorkflowTaskInfo, getWorkflowTaskApprover, getActionType } from './workflowTaskCache';
import { ApproverConfig, getConfiguredApprover } from './useApproverConfig';

// ─── Shared utilities ────────────────────────────────────────────────────────
/** Parse JotForm "YYYY-MM-DD HH:MM:SS" (UTC) or ISO 8601 string into a Date */
function parseUTC(s: string): Date {
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
}

/** Aging thresholds (days) for overallStatus classification */
const AGING_WARN_DAYS = 3;
const AGING_CRITICAL_DAYS = 7;
export function agingStatus(days: number): 'on-track' | 'delayed' | 'critical' {
  return days > AGING_CRITICAL_DAYS ? 'critical' : days > AGING_WARN_DAYS ? 'delayed' : 'on-track';
}

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

// ─── Parse approver name/email from JotFlow action text ─────────────────────
// Action text format: "Action: Approved | By: Murali BK (bk@bettroi.com) | Via: JotFlow | Date: ..."
export function parseApproverFromActionText(text: string): { name: string; email: string } | null {
  if (!text) return null;
  // Pattern: "By: Name (email@domain.com)"
  const match = text.match(/By:\s*([^(|]+?)\s*\(([^)]+@[^)]+)\)/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  // Pattern: "By: Name |" (no email in parens)
  const nameOnly = text.match(/By:\s*([^(|]+?)(?:\s*\||$)/);
  if (nameOnly) return { name: nameOnly[1].trim(), email: '' };
  return null;
}

// ─── F3: shared approver resolution ──────────────────────────────────────────
/**
 * Resolve the display name/email for an approver at a given level.
 *
 * Priority chain depends on status:
 *   - acted (approved/rejected) → parsed action text → config → workflow API → form field → fallback
 *   - pending                   →                       workflow API → form field → fallback
 *     (deliberately NOT using config for pending — see comment in caller)
 *
 * Returns final { name, email } strings (never null) so the caller can drop
 * straight into an ApprovalEntry.
 */
export function enrichApproverInfo(args: {
  status: 'approved' | 'rejected' | 'pending';
  level: number;
  formId: string;
  parsed: { name: string; email: string } | null;
  workflowApprover: { name: string; email: string } | null;
  approverConfigs: ApproverConfig[];
  /** Raw value from the JotForm "approver" field (often action text) */
  rawApproverField?: string;
  /** Email from evaluator-email field (per-level or global) */
  evaluatorEmail?: string;
  /** Email assigned in the form workflow step */
  stepAssigneeEmail?: string;
  /** Fallback label when no name is found anywhere (default: `Level {N} Approver`) */
  genericNameOverride?: string;
}): { name: string; email: string } {
  const {
    status, level, formId, parsed, workflowApprover, approverConfigs,
    rawApproverField, evaluatorEmail, stepAssigneeEmail, genericNameOverride,
  } = args;

  const rawIsActionText = !!rawApproverField && rawApproverField.includes('Action:');
  const rawNameFallback = rawApproverField && !rawIsActionText ? rawApproverField : '';
  const genericName = genericNameOverride ?? `Level ${level} Approver`;

  if (status === 'pending') {
    // PENDING: only use THIS submission's own data — don't inject guessed names from config
    return {
      name:
        workflowApprover?.name
        || evaluatorEmail
        || stepAssigneeEmail
        || rawNameFallback
        || genericName,
      email: workflowApprover?.email || '',
    };
  }

  // ACTED (approved/rejected): config is allowed as fallback.
  // Callers pass evaluatorEmail/stepAssigneeEmail only when those should be in the fallback chain
  // (e.g. multi-level rejected deliberately omits them, single-level acted includes them).
  const configApprover = getConfiguredApprover(approverConfigs, formId, level);
  return {
    name:
      parsed?.name
      || configApprover?.name
      || workflowApprover?.name
      || evaluatorEmail
      || stepAssigneeEmail
      || rawNameFallback
      || genericName,
    email: parsed?.email || configApprover?.email || workflowApprover?.email || '',
  };
}

// Pure submission forms — no approval status fields; always show "Open in JotForm"
const FORM_ONLY_IDS = new Set<string>();
// Reference to keep TS happy if unused — preserves the symbol the original file had.
void FORM_ONLY_IDS;

// ─── Map any JotForm submission using heuristically-detected fields ───────────
export function mapGenericSubmission(
  raw: Record<string, unknown>,
  formId: string,
  formTitle: string,
  fields: DetectedFields,
  workflowSteps: WorkflowStep[] = [],
  workflowTasks: WorkflowTaskInfo[] = [],
  approverConfigs: ApproverConfig[] = [],
): Submission {
  const answers = (raw.answers as Record<string, { answer: unknown; text?: string }>) || {};
  const get = (id: string | null) => id ? extractText(answers[id]?.answer) : '';

  // Build dynamic form table data from all answers
  const skipTypes = new Set(['control_button', 'control_head', 'control_pagebreak', 'control_divider', 'control_text', 'control_image', 'control_collapse', 'control_captcha']);
  const formTableData: Array<{ label: string; value: string }> = [];
  for (const [, field] of Object.entries(answers)) {
    const f = field as Record<string, unknown>;
    const fieldType = String(f.type || '');
    if (skipTypes.has(fieldType)) continue;
    const label = String(f.text || f.name || '');
    const value = extractText(f.answer);
    if (label) {
      formTableData.push({ label, value });
    }
  }

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
      const rawApproverField = get(lf.approverFieldId);
      const parsed = parseApproverFromActionText(rawApproverField);
      const wfApprover = getWorkflowTaskApprover(workflowTasks, lf.level);
      const date = get(lf.dateFieldId) || undefined;

      if (statusVal === 'approved') {
        const { name, email: approverEmail } = enrichApproverInfo({
          status: 'approved',
          level: lf.level,
          formId,
          parsed,
          workflowApprover: wfApprover,
          approverConfigs,
          rawApproverField,
          evaluatorEmail: getEvaluatorEmail(lf.level),
          stepAssigneeEmail: getStepAssignee(lf.level),
        });
        history.push({ level: lf.level as ApprovalLevel, approverName: name, approverEmail, status: 'approved', date });
        const isLast = lf.level === fields.levelFields[fields.levelFields.length - 1].level;
        currentLevel = isLast ? 'completed' : (lf.level + 1) as ApprovalLevel;
      } else if (statusVal === 'rejected' || statusVal === 'denied') {
        const { name, email: approverEmail } = enrichApproverInfo({
          status: 'rejected',
          level: lf.level,
          formId,
          parsed,
          workflowApprover: wfApprover,
          approverConfigs,
          rawApproverField,
        });
        history.push({ level: lf.level as ApprovalLevel, approverName: name, approverEmail, status: 'rejected', date });
        currentLevel = 'rejected';
        break;
      } else {
        const { name, email: approverEmail } = enrichApproverInfo({
          status: 'pending',
          level: lf.level,
          formId,
          parsed: null,
          workflowApprover: wfApprover,
          approverConfigs,
          rawApproverField,
          evaluatorEmail: getEvaluatorEmail(lf.level),
          stepAssigneeEmail: getStepAssignee(lf.level),
        });
        history.push({ level: lf.level as ApprovalLevel, approverName: name, approverEmail, status: 'pending' });
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

    const wfApprover = getWorkflowTaskApprover(workflowTasks, 1);
    const histStatus = typeof currentLevel === 'number' ? 'pending' : currentLevel === 'completed' ? 'approved' : 'rejected';
    const { name, email: approverEmail } = enrichApproverInfo({
      status: histStatus,
      level: 1,
      formId,
      parsed: null,
      workflowApprover: wfApprover,
      approverConfigs,
      evaluatorEmail,
      stepAssigneeEmail: getStepAssignee(1),
      genericNameOverride: 'Approver',
    });
    history.push({ level: 1 as ApprovalLevel, approverName: name, approverEmail, status: histStatus });
  }

  // Overall status field can override level computation
  const overallFinal = get(fields.overallStatusFieldId).toLowerCase();
  if (overallFinal.includes('complet')) currentLevel = 'completed';
  else if (overallFinal.includes('reject')) currentLevel = 'rejected';

  // needsSync is no longer needed — webhooks + real-time subscriptions handle updates automatically
  const needsSync = false;

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

  // Prepend metadata columns to match JotForm Tables view
  formTableData.unshift(
    { label: 'Submission Date', value: createdAt ? submissionDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '' },
    { label: 'Flow Status', value: genericJotformStatus }
  );

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
    formTableData,
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
    workflowInstanceId: (() => {
      const wfId = String(raw.workflowInstanceID || raw.workflow_instance_id || '') || undefined;
      if (raw.id) console.log(`[mapGenericSubmission] Sub ${raw.id}: Pass 1 workflowInstanceId from bulk API = "${wfId}"`);
      return wfId;
    })(),
    needsSync,
    pendingApproverName: (() => {
      const pending = history.find(h => h.status === 'pending');
      return pending?.approverName || undefined;
    })(),
    pendingApproverEmail: (() => {
      const pending = history.find(h => h.status === 'pending');
      return pending?.approverEmail || undefined;
    })(),
  };
}

// ─── Map a Supabase row back to a Submission ──────────────────────────────────
export function mapSupabaseRow(row: Record<string, unknown>): Submission {
  const raw = (row.raw_data as Record<string, unknown>) || {};

  // Fallback: use the pre-mapped fields from Supabase
  // level_history (top-level, written by webhook) takes priority over raw_data._mapped.levels (written by sync-to-supabase)
  const mapped = (raw._mapped as Record<string, unknown>) || {};
  const levelHistory = (row.level_history as Array<Record<string, unknown>>) || (mapped.levels as Array<Record<string, unknown>>) || [];
  const history: ApprovalEntry[] = levelHistory.map(l => {
    // Normalize both shapes: webhook writes { id, approver }, sync writes { level, approverName }
    const levelNum = Number(l.id ?? l.level ?? 0);
    const approverRaw = String(l.approver ?? l.approverName ?? '');
    const parsed = parseApproverFromActionText(approverRaw);
    return {
      level: levelNum as ApprovalLevel,
      approverName: parsed?.name || (approverRaw && !approverRaw.includes('Action:') ? approverRaw : '') || `Level ${levelNum} Approver`,
      approverEmail: parsed?.email || String(l.approverEmail ?? ''),
      status: (String(l.status ?? '').toLowerCase() === 'approved' ? 'approved' : String(l.status ?? '').toLowerCase() === 'rejected' ? 'rejected' : 'pending') as 'approved' | 'rejected' | 'pending',
      date: String(l.date ?? '') || undefined,
    };
  });

  const totalDays = Number(row.total_days) || 0;
  const status = String(row.status || 'pending');
  const currentLevel: ApprovalLevel | 'completed' | 'rejected' =
    status === 'completed' ? 'completed' : status === 'rejected' ? 'rejected' : (Number(row.current_level) || 1) as ApprovalLevel;

  const sbId = String(row.jotform_submission_id);
  const sbFormId = String(row.form_id || '');

  const pendingApproverName = String(row.pending_approver_name || '') || undefined;
  const pendingApproverEmail = String(row.pending_approver_email || '') || undefined;
  const submitterEmail = String(row.submitter_email || (mapped.email as string) || '');

  // Enrich history with pending approver from Supabase if available
  if (pendingApproverName) {
    const pendingEntry = history.find(h => h.status === 'pending');
    if (pendingEntry && (pendingEntry.approverName.startsWith('Level ') || !pendingEntry.approverName)) {
      pendingEntry.approverName = pendingApproverName;
      pendingEntry.approverEmail = pendingApproverEmail;
    }
  }

  const sbFormTitle = String(row.form_title || row.title || 'Form');
  const sbPrefix = sbFormTitle.split(/\s+/).filter(Boolean).map((w: string) => w[0]).join('').toUpperCase().slice(0, 3) || 'F';

  return {
    id: sbId,
    formId: sbFormId,
    formTitle: sbFormTitle,
    referenceNumber: `${sbPrefix}-${sbId.slice(-6)}`,
    title: String(row.title || 'Request'),
    description: String(row.description || row.title || 'Request'),
    editLink: String(row.edit_link || '') || undefined,
    actionType: 'approval' as WorkflowActionType,
    taskUrl: `https://eforms.mediaoffice.ae/inbox/${sbFormId}/${sbId}`,
    formUrl: `https://eforms.mediaoffice.ae/inbox/${sbFormId}/${sbId}`,
    submittedBy: {
      name: String(row.submitter_name || row.submitted_by || 'Unknown'),
      department: String(row.department || 'General'),
      email: submitterEmail,
    },
    submissionDate: String(row.submission_date || new Date().toISOString()).slice(0, 10),
    currentApprovalLevel: currentLevel,
    approvalHistory: history,
    daysAtCurrentLevel: totalDays,
    totalDaysSinceSubmission: totalDays,
    overallStatus: agingStatus(totalDays),
    jotformStatus: String(row.jotform_status || row.status || (currentLevel === 'completed' ? 'Completed' : currentLevel === 'rejected' ? 'Rejected' : 'Pending')),
    priority: (String(row.priority || 'medium') as 'low' | 'medium' | 'high' | 'urgent'),
    answers: (row.answers as Record<string, string>) || { description: String(row.title || ''), amount: String(row.amount || (mapped.amount as string) || ''), department: String(row.department || ''), email: submitterEmail, requester: String(row.submitted_by || '') },
    pendingApproverName,
    pendingApproverEmail,
    approvalUrl: String(row.approval_url || '') || undefined,
    workflowInstanceId: String(row.workflow_instance_id || '') || undefined,
  } as Submission;
}
