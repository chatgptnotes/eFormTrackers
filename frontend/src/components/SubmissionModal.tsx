import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, CheckCircle2, Clock, XCircle, User, Calendar, Building2, FileText,
  Send, Loader2, PenLine, AlertCircle, ClipboardList, FileEdit, ExternalLink,
} from 'lucide-react';
import { Submission } from '../types';
import jotformApi from '../services/jotformApi';
import SignaturePad from './SignaturePad';
import { getUserConfig } from '../config/currentUser';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';
import { humanizeError, messageFromStatus } from '../lib/errors';

interface Props {
  submission: Submission | null;
  onClose: () => void;
  /** Called after a successful approve/reject. Passes submissionId, new level, and new status string so parent can optimistically update. */
  onUpdate?: (submissionId?: string, newLevel?: import('../types').ApprovalLevel | 'completed' | 'rejected', newJotformStatus?: string) => void;
}

const levelColors: Record<string, string> = {
  '1': 'bg-teal-500',
  '2': 'bg-teal-600',
  '3': 'bg-teal-700',
  '4': 'bg-teal-800',
  'completed': 'bg-emerald-600',
  'rejected': 'bg-slate-500',
};

type FieldMap = { statusField: string; approverField: string | null; overallStatusField: string | null };

function getFieldMap(submission: Submission, level: number): FieldMap | null {
  if (submission.levelFieldMap) {
    const lf = submission.levelFieldMap.find(m => m.level === level);
    if (lf) return { statusField: lf.statusFieldId, approverField: lf.approverFieldId, overallStatusField: lf.overallStatusFieldId };
  }
  return null;
}

/**
 * Call /api/ensure-fields to create hidden approval status fields on the JotForm form.
 * Returns a levelFieldMap that can be used for approval actions.
 */
async function ensureFields(formId: string): Promise<{
  levelFieldMap: { level: number; statusFieldId: string; approverFieldId: string | null; overallStatusFieldId: string | null }[];
} | null> {
  try {
    const data = await apiFetch<{ fields?: { level: number; statusFieldId: string; approverFieldId: string }[]; overallStatusFieldId?: string }>(
      `/api/ensure-fields?formId=${formId}`,
      { method: 'POST' }
    );
    if (!data.fields || data.fields.length === 0) return null;
    const overallId = data.overallStatusFieldId || null;
    return {
      levelFieldMap: data.fields.map((f) => ({
        level: f.level,
        statusFieldId: f.statusFieldId,
        approverFieldId: f.approverFieldId || null,
        overallStatusFieldId: overallId,
      })),
    };
  } catch {
    return null;
  }
}

// All approval levels require signature — every Approve action must be signed

export default function SubmissionModal({ submission, onClose, onUpdate }: Props) {
  const { user } = useAuth();
  const currentUser = getUserConfig(user?.email);

  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  // AbortController ref — cancelled when modal closes or submission changes
  const abortRef = useRef<AbortController | null>(null);
  const [pushResult, setPushResult] = useState<{ success: boolean; message: string } | null>(null);
  const [comment, setComment] = useState('');
  const [signature, setSignature] = useState('');
  // Two-click confirmation: 'approve' | 'reject' | null
  const [confirmPending, setConfirmPending] = useState<'approve' | 'reject' | null>(null);

  const [ensuringFields, setEnsuringFields] = useState(false);
  // Dynamically resolved field map (from ensureFields API) — used when form has no built-in fields
  const [dynamicFieldMap, setDynamicFieldMap] = useState<{ level: number; statusFieldId: string; approverFieldId: string | null; overallStatusFieldId: string | null }[] | null>(null);

  const isSubmitting = approving || rejecting || uploadingSignature || ensuringFields;

  const level = typeof submission?.currentApprovalLevel === 'number' ? submission.currentApprovalLevel : null;
  const signatureRequired = level !== null;

  // Check if this form supports direct approval (has known field map or dynamic one)
  const hasStaticFieldMap = submission !== null && level !== null && getFieldMap(submission, level) !== null;
  // For forms without static field maps, auto-ensure fields when modal opens
  const supportsDirectApproval = hasStaticFieldMap || dynamicFieldMap !== null;

  // ── Who is the designated approver for the current level? ────────────────
  // pendingEntry.approverName is the evaluator email from the form answers.
  const pendingEntry = submission
    ? (typeof submission.currentApprovalLevel === 'number'
        ? submission.approvalHistory.find(a => a.level === submission.currentApprovalLevel && a.status === 'pending')
        : submission.approvalHistory.find(a => a.status === 'pending'))
    : null;
  const designatedApproverEmail = submission?.pendingApproverEmail || pendingEntry?.approverEmail || pendingEntry?.approverName || '';
  // isDesignatedApprover: true only if logged-in user's email matches the
  // evaluator email. No role override — matches the backend assignee-only gate.
  const isDesignatedApprover = !!user?.email &&
    designatedApproverEmail.toLowerCase() === user.email.toLowerCase();

  // Comment is optional — signature is required only for L3/L4 approvals
  const approveEnabled = isDesignatedApprover && (!signatureRequired || signature !== '');
  const rejectEnabled = isDesignatedApprover;

  const handleApproval = async (action: 'approve' | 'reject') => {
    if (!submission || typeof submission.currentApprovalLevel !== 'number') return;
    if (action === 'approve' && signatureRequired && !signature) return;

    action === 'approve' ? setApproving(true) : setRejecting(true);
    setPushResult(null);

    const lvl = submission.currentApprovalLevel;
    // Try static field map first, then dynamic (from ensure-fields API)
    let fields = getFieldMap(submission, lvl);
    if (!fields && dynamicFieldMap) {
      const df = dynamicFieldMap.find(m => m.level === lvl);
      if (df) fields = { statusField: df.statusFieldId, approverField: df.approverFieldId, overallStatusField: df.overallStatusFieldId };
    }
    // If no form fields found, we still proceed — workflow-action API doesn't need them

    const actionLabel = action === 'approve' ? 'Approved' : 'Rejected';
    const timestamp = new Date().toLocaleString('en-AE', { timeZone: 'Asia/Dubai', hour12: true });

    // Upload signature to Supabase Storage and get a public URL
    let signatureUrl = '';
    if (action === 'approve' && signature) {
      setUploadingSignature(true);
      const uploadCtrl = new AbortController();
      abortRef.current = uploadCtrl;
      const uploadTimeout = setTimeout(() => uploadCtrl.abort(), 20000);
      try {
        const uploadData = await apiFetch<{ signatureUrl?: string; error?: string }>('/api/upload-signature', {
          method: 'POST',
          body: JSON.stringify({
            submissionId: submission.id,
            level: lvl,
            signatureData: signature,
            comment: comment.trim(),
            approverName: currentUser.name,
          }),
          signal: uploadCtrl.signal,
          throwOnError: false,
        });
        clearTimeout(uploadTimeout);
        if (uploadData.signatureUrl) {
          signatureUrl = uploadData.signatureUrl;
        } else {
          setPushResult({ success: false, message: messageFromStatus(0, uploadData.error) });
          setUploadingSignature(false);
          setApproving(false);
          return;
        }
      } catch (err) {
        clearTimeout(uploadTimeout);
        const msg = humanizeError(err, 'Signature upload failed. Please try again.');
        setPushResult({ success: false, message: msg });
        setUploadingSignature(false);
        setApproving(false);
        return;
      }
      abortRef.current = null;
      setUploadingSignature(false);
    }

    // Structured note — easy to parse for auditing/reporting
    const noteParts = [
      `Action: ${actionLabel}`,
      `By: ${currentUser.name} (${user?.email || 'unknown'})`,
      `Via: JotFlow`,
      `Date: ${timestamp}`,
      `Comment: ${comment.trim()}`,
      ...(signatureUrl ? [`Signature: ${signatureUrl}`] : []),
    ];
    const approverNote = noteParts.join(' | ');

    // Determine if this is the last approval level for this form
    const maxLevel = submission.levelFieldMap
      ? Math.max(...submission.levelFieldMap.map(m => m.level))
      : submission.approvalHistory.length > 0
        ? Math.max(...submission.approvalHistory.map(h => h.level))
        : 4;
    const isLastLevel = lvl >= maxLevel;

    // Use workflow action API to approve/reject directly in JotForm's workflow engine
    let result: { success: boolean; message: string };
    let instanceCompleted = false;
    try {
      const wfAction = action === 'approve' ? 'approve' : 'reject';
      // throwOnError:true so a 403 (non-assignee) / 4xx surfaces as an ApiError with
      // the real status — humanizeError turns 403 into "You don't have permission…".
      // Never report false success on a failed action.
      const data = await apiFetch<{ ok?: boolean; instanceCompleted?: boolean; error?: string }>('/api/workflow-action', {
        method: 'POST',
        body: JSON.stringify({
          submissionId: submission.id,
          action: wfAction,
          comment: comment.trim() || approverNote,
          signature: signature || undefined,
        }),
      });
      if (data.ok) {
        result = { success: true, message: `${actionLabel} successfully via workflow engine` };
        instanceCompleted = data.instanceCompleted === true;
      } else {
        result = { success: false, message: messageFromStatus(0, data.error) };
      }
    } catch (err) {
      result = { success: false, message: humanizeError(err) };
    }

    // Also update form fields as backup (only for forms that have status fields)
    if (fields) {
      try {
        const updates: Record<string, string> = { [fields.statusField]: actionLabel };
        if (fields.approverField && fields.approverField !== fields.statusField) {
          updates[fields.approverField] = approverNote;
        }
        if (fields.overallStatusField) {
          if (action === 'reject') updates[fields.overallStatusField] = 'Rejected';
          else if (isLastLevel) updates[fields.overallStatusField] = 'Completed';
          else updates[fields.overallStatusField] = 'In Progress';
        }
        await jotformApi.updateSubmission(submission.id, updates, {
          _action: action,
          _level: String(lvl),
          _signatureUrl: signatureUrl,
        });
      } catch {} // form field update is best-effort backup
    }

    setPushResult(result);
    setApproving(false);
    setRejecting(false);

    if (result.success && onUpdate) {
      // Use instanceCompleted from workflow API — don't guess isLastLevel
      let newLevel: import('../types').ApprovalLevel | 'completed' | 'rejected' | undefined;
      let newJotformStatus: string | undefined;
      if (action === 'reject') {
        newLevel = 'rejected';
        newJotformStatus = 'Rejected';
      } else if (instanceCompleted) {
        newLevel = 'completed';
        newJotformStatus = 'Completed';
      } else {
        // Workflow advanced to next step — don't mark as completed
        newLevel = (lvl + 1) as import('../types').ApprovalLevel;
        newJotformStatus = 'In Progress';
      }

      // Immediately patch Supabase cache with complete data
      const sbStatus = action === 'reject' ? 'rejected' : (instanceCompleted ? 'completed' : 'in_progress');
      const sbLevel = action === 'reject' ? lvl : (instanceCompleted ? 999 : lvl + 1);
      apiFetch(`/api/submissions/${submission.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          current_level: sbLevel,
          status: sbStatus,
          jotform_status: newJotformStatus,
          approver_name: currentUser.name,
          pending_approver_name: action === 'reject' || instanceCompleted ? null : undefined,
          pending_approver_email: action === 'reject' || instanceCompleted ? null : undefined,
          last_synced: new Date().toISOString(),
        }),
      }).catch(() => {}); // fire and forget — don't block UI

      // Notify parent immediately for optimistic update + staggered refresh
      onUpdate(submission.id, newLevel, newJotformStatus);
    }

    // Auto-close after a successful action — brief delay so the user sees the
    // confirmation banner, then we return them to the list.
    if (result.success) {
      window.setTimeout(() => onClose(), 1200);
    }
  };

  const openTaskUrl = () => {
    if (!submission?.taskUrl) return;
    // Link to main form's inbox for this submission — the native JotForm
    // "View Task" button on that page leads to the actual task completion URL.
    // (JotForm does not expose the approval-form task URL via API.)
    window.open(submission.taskUrl, '_blank', 'noopener,noreferrer');
  };

  const openFormUrl = () => {
    if (!submission?.formUrl) return;
    // Link to main form's inbox for this submission — the native JotForm
    // "View This Form" button on that page leads to the actual form-fill URL.
    // (JotForm does not expose the internal form-fill URL per-submission via API.)
    window.open(submission.formUrl, '_blank', 'noopener,noreferrer');
  };

  // Reset form when submission changes; cancel any in-flight upload
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setComment('');
    setSignature('');
    setPushResult(null);
    setUploadingSignature(false);
    setApproving(false);
    setRejecting(false);
    setConfirmPending(null);
    setDynamicFieldMap(null);
  }, [submission?.id]);

  // Auto-ensure fields for forms that don't have status fields
  useEffect(() => {
    if (!submission || !level) return;
    if (hasStaticFieldMap) return; // already has fields
    if (dynamicFieldMap) return; // already resolved

    let cancelled = false;
    setEnsuringFields(true);
    ensureFields(submission.formId).then(result => {
      if (cancelled) return;
      setEnsuringFields(false);
      if (result) {
        setDynamicFieldMap(result.levelFieldMap);
      }
    });
    return () => { cancelled = true; };
  }, [submission?.id, submission?.formId, level, hasStaticFieldMap, dynamicFieldMap]);

  // Keyboard: Esc to close — blocked while submission is in progress
  useEffect(() => {
    if (!submission) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [submission, onClose, isSubmitting]);

  if (!submission) return null;

  const levelLabel = typeof submission.currentApprovalLevel === 'number'
    ? `Level ${submission.currentApprovalLevel}`
    : submission.currentApprovalLevel;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={isSubmitting ? undefined : onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 8 }}
          transition={{ type: 'spring', damping: 22, stiffness: 280 }}
          onClick={e => e.stopPropagation()}
          className="glass-card w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl"
        >
          {/* Header — sticky, ref + title + form, with status chips inline on desktop */}
          <div className="px-7 pt-6 pb-5 border-b border-slate-200/80 flex items-start justify-between sticky top-0 bg-white/95 backdrop-blur z-10">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] tracking-wider font-bold text-teal-600 uppercase">{submission.referenceNumber}</span>
                <span className="text-slate-300">·</span>
                <span className="text-[11px] text-slate-500">{submission.formTitle}</span>
              </div>
              <h3 className="text-[22px] font-bold text-slate-900 mt-1 leading-tight truncate">{submission.title}</h3>
            </div>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              aria-label="Close submission modal"
              className="ml-4 p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={isSubmitting ? 'Please wait until submission completes' : 'Close'}
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {/* Body */}
          <div className="px-7 py-6 space-y-6">
            {/* Status chips — prominent, single row */}
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold text-white shadow-sm ${levelColors[String(submission.currentApprovalLevel)]}`}>
                {levelLabel}
              </span>
              <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold status-${submission.overallStatus}`}>
                {submission.overallStatus}
              </span>
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                <Clock className="w-3 h-3" />
                {submission.totalDaysSinceSubmission} days total
              </span>
            </div>

            {/* Info grid — clean 2x2 with subtle icon backgrounds */}
            <div className="grid grid-cols-2 gap-x-5 gap-y-4 p-4 rounded-xl bg-slate-50/60 border border-slate-200/60">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-slate-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">Submitted By</p>
                  <p className="text-sm text-slate-900 font-medium truncate">{submission.submittedBy.name}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-slate-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">Department</p>
                  <p className="text-sm text-slate-900 font-medium truncate">{submission.submittedBy.department}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                  <Calendar className="w-4 h-4 text-slate-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">Submitted</p>
                  <p className="text-sm text-slate-900 font-medium truncate">{submission.submissionDate}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-slate-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">Form ID</p>
                  <p className="text-sm text-slate-900 font-medium font-mono truncate">{submission.formId}</p>
                </div>
              </div>
            </div>

            {/* Action section — primary card, teal accent */}
            {typeof submission.currentApprovalLevel === 'number' && (
              <div className="rounded-xl p-5 bg-gradient-to-br from-teal-50/60 to-white border border-teal-200/60 shadow-sm space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-[15px] font-bold text-slate-900 flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-teal-100 flex items-center justify-center">
                      <Send className="w-3.5 h-3.5 text-teal-700" />
                    </span>
                    {submission.actionType === 'task' ? 'Task Action' :
                     submission.actionType === 'form' ? 'Complete Form' :
                     `Take Action — Level ${submission.currentApprovalLevel}`}
                  </h4>
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold whitespace-nowrap">
                    {submission.actionType === 'approval' ? 'JotForm Enterprise' : 'Opens in JotForm'}
                  </span>
                </div>

                {/* ── TASK step ── */}
                {submission.actionType === 'task' && (
                  <div className="space-y-3">
                    {/* Show who needs to act */}
                    {!isDesignatedApprover && designatedApproverEmail && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        <p className="text-xs text-amber-300">
                          Task assigned to <span className="font-semibold">{designatedApproverEmail}</span>
                        </p>
                      </div>
                    )}
                    <p className="text-sm text-gray-400">
                      Review the task details and mark it complete when done.
                    </p>
                    {/* Comment field for task */}
                    <textarea
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                      placeholder="Task completion note (optional)..."
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg bg-navy-light/30 border border-navy-light/40 text-white text-sm placeholder-gray-500 resize-none focus:outline-none focus:border-teal-500/50"
                    />
                    {pushResult && (
                      <div className={`p-3 rounded-lg text-sm ${pushResult.success ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-red-500/10 text-red-300 border border-red-500/20'}`}>
                        {pushResult.message}
                      </div>
                    )}
                    <button
                      onClick={() => setConfirmPending('approve')}
                      disabled={!isDesignatedApprover || isSubmitting}
                      title={!isDesignatedApprover ? `Only ${designatedApproverEmail} can complete this task` : ''}
                      className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-teal-600 hover:bg-teal-500 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-sm border border-teal-600 transition-all"
                    >
                      {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />}
                      {approving ? 'Marking Complete...' : 'Mark Task Complete'}
                    </button>
                  </div>
                )}

                {/* ── FORM step ── */}
                {submission.actionType === 'form' && (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-400">
                      This step requires filling out or completing a form in JotForm. Click below to open it.
                    </p>
                    <button
                      onClick={openFormUrl}
                      className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-teal-500/15 hover:bg-teal-500/25 text-teal-600 rounded-xl font-semibold text-sm border border-teal-500/20 transition-all"
                    >
                      <FileEdit className="w-4 h-4" />
                      Complete Form in JotForm
                      <ExternalLink className="w-3.5 h-3.5 opacity-60" />
                    </button>
                  </div>
                )}

                {/* ── APPROVAL step ── (existing full flow) */}
                {submission.actionType === 'approval' && (<>

                {/* Steps indicator — elegant progress pills */}
                <div className="flex items-center gap-1.5 text-xs">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold transition-colors ${comment.trim() ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                    <span className="w-4 h-4 rounded-full bg-white/70 flex items-center justify-center text-[10px] font-bold">{comment.trim() ? '✓' : '1'}</span>
                    Comment
                  </span>
                  {signatureRequired && (
                    <>
                      <span className="text-slate-300 mx-0.5">→</span>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold transition-colors ${signature ? 'bg-emerald-100 text-emerald-700' : 'bg-teal-50 text-teal-700 border border-teal-200'}`}>
                        <span className="w-4 h-4 rounded-full bg-white/70 flex items-center justify-center text-[10px] font-bold">{signature ? '✓' : '2'}</span>
                        Signature
                      </span>
                    </>
                  )}
                  <span className="text-slate-300 mx-0.5">→</span>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold transition-colors ${approveEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    <span className="w-4 h-4 rounded-full bg-white/70 flex items-center justify-center text-[10px] font-bold">{signatureRequired ? '3' : '2'}</span>
                    Approve
                  </span>
                </div>

                {/* Step 1: Comment */}
                <div>
                  <label className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-700 mb-2">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-amber-100 text-amber-700 text-[10px] font-bold">1</span>
                    Comment
                    <span className="text-slate-400 font-normal text-xs">(optional)</span>
                  </label>
                  <textarea
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    placeholder="Enter your comment or reason for approval/rejection..."
                    rows={2}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-white border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 text-sm text-slate-900 placeholder-slate-400 focus:outline-none resize-none transition-all"
                  />
                </div>

                {/* Step 2: Signature — required for Level 3 & 4 approvals */}
                {signatureRequired && (
                  <div>
                    <label className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-700 mb-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-teal-100 text-teal-700">
                        <PenLine className="w-3 h-3" />
                      </span>
                      Digital Signature
                      <span className="text-rose-500 font-bold">*</span>
                      <span className="text-slate-400 font-normal text-xs">required for Level {submission.currentApprovalLevel}</span>
                    </label>
                    {signature ? (
                      <div className="relative border-2 border-emerald-300 rounded-xl overflow-hidden bg-white shadow-sm">
                        <img src={signature} alt="Signature" className="w-full object-contain bg-slate-50/50" style={{ height: '150px' }} />
                        <div className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-100 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                          <span className="text-[11px] text-emerald-700 font-bold">Signature captured</span>
                        </div>
                        <button
                          onClick={() => setSignature('')}
                          className="absolute top-3 right-3 px-2.5 py-1 rounded-md bg-white text-slate-600 hover:text-rose-600 hover:bg-slate-50 text-xs font-medium border border-slate-200 transition-colors shadow-sm"
                        >
                          Re-sign
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white overflow-hidden hover:border-teal-400 transition-colors">
                        <SignaturePad onSign={setSignature} height={150} />
                      </div>
                    )}
                  </div>
                )}

                {/* Step 3: Approve / Reject — two-click confirmation */}
                {confirmPending ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                      <p className="text-sm text-amber-900 font-semibold">
                        Confirm {(submission as Submission)?.actionType === 'task' ? 'Task Completion' : confirmPending === 'approve' ? 'Approval' : 'Rejection'}
                        <span className="block text-xs text-amber-700 font-normal mt-0.5">This action cannot be undone.</span>
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setConfirmPending(null); handleApproval(confirmPending); }}
                        disabled={isSubmitting}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold text-sm transition-all disabled:opacity-40 shadow-sm ${
                          confirmPending === 'approve'
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'bg-rose-600 hover:bg-rose-700 text-white'
                        }`}
                      >
                        {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : confirmPending === 'approve' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                        {uploadingSignature ? 'Saving signature...' : approving || rejecting ? 'Submitting...' : (submission as Submission)?.actionType === 'task' ? 'Yes, Mark Complete' : `Yes, ${confirmPending === 'approve' ? 'Approve' : 'Reject'}`}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmPending(null)}
                        disabled={isSubmitting}
                        className="px-4 py-2.5 rounded-lg font-semibold text-sm bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-40"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 pt-1">
                    {/* Show who needs to act if it's not the current user */}
                    {!isDesignatedApprover && designatedApproverEmail && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        <p className="text-xs text-amber-300">
                          Awaiting approval from <span className="font-semibold">{designatedApproverEmail}</span>
                        </p>
                      </div>
                    )}
                  <div className="flex gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setConfirmPending('approve')}
                      disabled={!approveEnabled || isSubmitting}
                      title={!isDesignatedApprover ? `Only ${designatedApproverEmail} can approve at this level` : ''}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm shadow-sm hover:shadow-md transition-all"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Approve &amp; Sign
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmPending('reject')}
                      disabled={!rejectEnabled || isSubmitting}
                      title={!isDesignatedApprover ? `Only ${designatedApproverEmail} can reject at this level` : ''}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm shadow-sm hover:shadow-md transition-all"
                    >
                      <XCircle className="w-4 h-4" /> Reject
                    </button>
                  </div>
                  </div>
                )}

                {/* What's still needed */}
                {signatureRequired && !signature && (
                  <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <p className="font-medium">Draw your signature above to enable Approve</p>
                  </div>
                )}

                {pushResult && (
                  <div className={`p-3 rounded-lg text-sm font-medium ${
                    pushResult.success
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-red-500/20 text-red-400 border border-red-500/30'
                  }`}>
                    {pushResult.success ? '✅ Successfully pushed to JotForm Enterprise!' : `❌ ${pushResult.message}`}
                  </div>
                )}
                </>)}
              </div>
            )}

            {/* Approval Timeline */}
            <div>
              <h4 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                <span className="w-1 h-4 bg-teal-600 rounded-full" />
                Approval Timeline
              </h4>
              <div className="space-y-0">
                {submission.approvalHistory.map((entry, i) => (
                  <div key={i} className="flex items-start gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center ring-4 ${
                        entry.status === 'approved' ? 'bg-emerald-500 text-white ring-emerald-100' :
                        entry.status === 'rejected' ? 'bg-rose-500 text-white ring-rose-100' :
                        'bg-amber-500 text-white ring-amber-100'
                      }`}>
                        {entry.status === 'approved' ? <CheckCircle2 className="w-4 h-4" /> :
                         entry.status === 'rejected' ? <XCircle className="w-4 h-4" /> :
                         <Clock className="w-4 h-4" />}
                      </div>
                      {i < submission.approvalHistory.length - 1 && (
                        <div className="w-px h-12 bg-slate-200 mt-1" />
                      )}
                    </div>
                    <div className="pb-6 flex-1 min-w-0">
                      {(() => {
                        const isGeneric = /^Level \d+ Approver$/.test(entry.approverName) || entry.approverName === 'Approver';
                        return (
                          <p className="text-sm font-semibold text-slate-900">
                            <span className="text-teal-700">Level {entry.level}</span>
                            <span className="text-slate-400 mx-1.5">·</span>
                            {isGeneric && entry.status === 'pending'
                              ? <span className="text-amber-700 italic font-medium">Pending Review</span>
                              : <>
                                  {entry.approverName}
                                  {entry.approverEmail && !entry.approverName.includes('@') && (
                                    <span className="text-xs text-slate-500 font-normal ml-1">({entry.approverEmail})</span>
                                  )}
                                </>
                            }
                          </p>
                        );
                      })()}
                      <p className={`text-xs mt-1 font-medium ${
                        entry.status === 'pending' ? 'text-amber-700' :
                        entry.status === 'rejected' ? 'text-rose-700' :
                        'text-emerald-700'
                      }`}>
                        {entry.status === 'pending' ? 'Pending approval' : `${entry.status} on ${entry.date}`}
                      </p>
                      {entry.comments && (
                        <div className="mt-2 space-y-2">
                          {(() => {
                            const signatureMatch = entry.comments.match(/Signature:\s*(https?:\/\/[^\s|]+)/);
                            const signatureUrl = signatureMatch ? signatureMatch[1] : null;
                            const commentText = entry.comments.replace(/\s*\|\s*Signature:\s*https?:\/\/[^\s|]*/, '').replace(/^Action:.*?\|\s*/, '');

                            return (
                              <>
                                {commentText && (
                                  <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                                    <p className="text-xs text-slate-700 italic">"{commentText}"</p>
                                  </div>
                                )}
                                {signatureUrl && entry.status === 'approved' && (
                                  <div className="mt-2 border border-emerald-200 rounded-lg overflow-hidden bg-white p-2 max-w-xs">
                                    <img src={signatureUrl} alt="Signature" className="w-full h-auto" />
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

      </motion.div>
    </AnimatePresence>
  );
}
