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
import { supabase } from '../lib/supabase';

interface Props {
  submission: Submission | null;
  onClose: () => void;
  /** Called after a successful approve/reject. Passes submissionId, new level, and new status string so parent can optimistically update. */
  onUpdate?: (submissionId?: string, newLevel?: import('../types').ApprovalLevel | 'completed' | 'rejected', newJotformStatus?: string) => void;
}

const levelColors: Record<string, string> = {
  '1': 'bg-blue-500',
  '2': 'bg-amber-500',
  '3': 'bg-purple-500',
  '4': 'bg-red-500',
  'completed': 'bg-emerald-500',
  'rejected': 'bg-gray-500',
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
    const res = await fetch(`/api/ensure-fields?formId=${formId}`, { method: 'POST' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.fields || data.fields.length === 0) return null;
    const overallId = data.overallStatusFieldId || null;
    return {
      levelFieldMap: data.fields.map((f: { level: number; statusFieldId: string; approverFieldId: string }) => ({
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

// Director-level approvals require signature
// All approval levels require signature — every Approve action must be signed
const SIGNATURE_REQUIRED_LEVELS = [1, 2, 3, 4];

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
  const signatureRequired = level !== null && SIGNATURE_REQUIRED_LEVELS.includes(level);

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
  const designatedApproverEmail = pendingEntry?.approverName ?? '';
  // isDesignatedApprover: true if logged-in user's email matches the evaluator email
  const isDesignatedApprover = !!user?.email && (
    designatedApproverEmail.toLowerCase() === user.email.toLowerCase() ||
    currentUser.isAdmin === true  // admins can always override (e.g. bk@bettroi.com)
  );

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
        const uploadRes = await fetch('/api/upload-signature', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            submissionId: submission.id,
            level: lvl,
            signatureData: signature,
            comment: comment.trim(),
            approverName: currentUser.name,
          }),
          signal: uploadCtrl.signal,
        });
        clearTimeout(uploadTimeout);
        const uploadData = await uploadRes.json();
        if (uploadData.signatureUrl) {
          signatureUrl = uploadData.signatureUrl;
        } else {
          setPushResult({ success: false, message: `Signature could not be saved: ${uploadData.error || 'Unknown error'}. Please try again.` });
          setUploadingSignature(false);
          setApproving(false);
          return;
        }
      } catch (err) {
        clearTimeout(uploadTimeout);
        const msg = (err as Error).name === 'AbortError'
          ? 'Signature upload timed out. Please try again.'
          : `Signature upload failed: ${(err as Error).message}. Please try again.`;
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
      const res = await fetch('/api/workflow-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: submission.id,
          action: wfAction,
          comment: comment.trim() || approverNote,
          signature: signature || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        result = { success: true, message: `${actionLabel} successfully via workflow engine` };
        instanceCompleted = data.instanceCompleted === true;
      } else {
        result = { success: false, message: data.error || `Workflow action failed: ${res.status}` };
      }
    } catch (err) {
      result = { success: false, message: `Workflow action error: ${(err as Error).message}` };
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
      supabase
        .from('jf_submissions')
        .update({
          current_level: sbLevel,
          status: sbStatus,
          jotform_status: newJotformStatus,
          approver_name: currentUser.name,
          pending_approver_name: action === 'reject' || instanceCompleted ? null : undefined,
          pending_approver_email: action === 'reject' || instanceCompleted ? null : undefined,
          last_synced: new Date().toISOString(),
        })
        .eq('jotform_submission_id', submission.id)
        .then(() => {}); // fire and forget — don't block UI

      // Notify parent immediately for optimistic update + staggered refresh
      onUpdate(submission.id, newLevel, newJotformStatus);
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
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={e => e.stopPropagation()}
          className="glass-card w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="p-6 border-b border-navy-light/20 flex items-start justify-between sticky top-0 bg-navy-dark/95 z-10">
            <div>
              <p className="text-xs text-gold font-medium">{submission.referenceNumber}</p>
              <h3 className="text-xl font-bold text-white mt-1">{submission.title}</h3>
              <p className="text-sm text-gray-400 mt-1">{submission.formTitle}</p>
            </div>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="p-2 rounded-lg hover:bg-navy-light/30 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              title={isSubmitting ? 'Please wait until submission completes' : 'Close'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Details */}
          <div className="p-6 space-y-6">
            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="text-xs text-gray-500">Submitted By</p>
                  <p className="text-sm text-white">{submission.submittedBy.name}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Building2 className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="text-xs text-gray-500">Department</p>
                  <p className="text-sm text-white">{submission.submittedBy.department}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="text-xs text-gray-500">Submitted</p>
                  <p className="text-sm text-white">{submission.submissionDate}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="text-xs text-gray-500">Form ID</p>
                  <p className="text-sm text-white">{submission.formId}</p>
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center gap-4">
              <span className={`px-3 py-1 rounded-full text-xs font-bold text-white ${levelColors[String(submission.currentApprovalLevel)]}`}>
                {levelLabel}
              </span>
              <span className={`px-3 py-1 rounded-full text-xs font-bold status-${submission.overallStatus}`}>
                {submission.overallStatus}
              </span>
              <span className="text-xs text-gray-500">{submission.totalDaysSinceSubmission} days total</span>
            </div>

            {/* Action section */}
            {typeof submission.currentApprovalLevel === 'number' && (
              <div className="bg-navy-light/30 rounded-xl p-4 border border-navy-light/20 space-y-4">
                <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  <Send className="w-4 h-4 text-gold" />
                  {submission.actionType === 'task' ? 'Task Action' :
                   submission.actionType === 'form' ? 'Complete Form' :
                   `Take Action — Level ${submission.currentApprovalLevel}`}
                  <span className="text-xs text-gray-500 font-normal ml-2">
                    {submission.actionType === 'approval' ? '(Pushes to JotForm Enterprise)' : '(Opens in JotForm)'}
                  </span>
                </h4>

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
                      className="w-full px-3 py-2 rounded-lg bg-navy-light/30 border border-navy-light/40 text-white text-sm placeholder-gray-500 resize-none focus:outline-none focus:border-gold/40"
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
                      className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-gold/20 hover:bg-gold/30 disabled:opacity-30 disabled:cursor-not-allowed text-gold rounded-xl font-semibold text-sm border border-gold/20 transition-all"
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
                      className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-xl font-semibold text-sm border border-blue-500/20 transition-all"
                    >
                      <FileEdit className="w-4 h-4" />
                      Complete Form in JotForm
                      <ExternalLink className="w-3.5 h-3.5 opacity-60" />
                    </button>
                  </div>
                )}

                {/* ── APPROVAL step ── (existing full flow) */}
                {submission.actionType === 'approval' && (<>

                {/* Steps indicator */}
                <div className="flex items-center gap-2 text-xs">
                  <span className={`flex items-center gap-1 px-2 py-1 rounded-full font-medium ${comment.trim() ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                    <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]">{comment.trim() ? '✓' : '1'}</span>
                    Comment
                  </span>
                  {signatureRequired && (
                    <>
                      <span className="text-gray-600">→</span>
                      <span className={`flex items-center gap-1 px-2 py-1 rounded-full font-medium ${signature ? 'bg-emerald-500/20 text-emerald-400' : 'bg-purple-500/20 text-purple-400'}`}>
                        <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]">{signature ? '✓' : '2'}</span>
                        Signature
                      </span>
                    </>
                  )}
                  <span className="text-gray-600">→</span>
                  <span className={`flex items-center gap-1 px-2 py-1 rounded-full font-medium ${approveEnabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-500'}`}>
                    <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]">{signatureRequired ? '3' : '2'}</span>
                    Approve
                  </span>
                </div>

                {/* Step 1: Comment */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400 mb-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                    Step 1 — Comment <span className="text-gray-500 font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    placeholder="Enter your comment or reason for approval/rejection..."
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg bg-navy-dark border border-navy-light/30 focus:border-gold/50 text-sm text-white placeholder-gray-600 focus:outline-none resize-none transition-colors"
                  />
                </div>

                {/* Step 2: Signature — required for Level 3 & 4 approvals */}
                {signatureRequired && (
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400 mb-1.5">
                      <PenLine className="w-3.5 h-3.5 text-purple-400" />
                      Step 2 — Digital Signature <span className="text-red-400 font-bold">*</span>
                      <span className="text-gray-500 font-normal ml-1">required for Level {submission.currentApprovalLevel}</span>
                    </label>
                    {signature ? (
                      <div className="relative border border-emerald-500/30 rounded-xl overflow-hidden bg-white">
                        <img src={signature} alt="Signature" className="w-full object-contain" style={{ height: '150px' }} />
                        <div className="absolute inset-0 flex items-center justify-end p-3">
                          <button
                            onClick={() => setSignature('')}
                            className="px-2.5 py-1 rounded-lg bg-navy-dark/80 text-gray-400 hover:text-red-400 text-xs border border-navy-light/30 transition-colors"
                          >
                            Re-sign
                          </button>
                        </div>
                        <div className="absolute top-2 left-3 px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30">
                          <span className="text-[10px] text-emerald-400 font-medium">✓ Signature captured</span>
                        </div>
                      </div>
                    ) : (
                      <SignaturePad onSign={setSignature} height={150} />
                    )}
                  </div>
                )}

                {/* Step 3: Approve / Reject — two-click confirmation */}
                {confirmPending ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                    <p className="text-xs text-amber-400 font-medium text-center">
                      ⚠️ Confirm {(submission as Submission)?.actionType === 'task' ? 'Task Completion' : confirmPending === 'approve' ? 'Approval' : 'Rejection'} — this cannot be undone
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setConfirmPending(null); handleApproval(confirmPending); }}
                        disabled={isSubmitting}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 ${
                          confirmPending === 'approve'
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                            : 'bg-red-600 hover:bg-red-500 text-white'
                        }`}
                      >
                        {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : confirmPending === 'approve' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                        {uploadingSignature ? 'Saving signature...' : approving || rejecting ? 'Submitting...' : (submission as Submission)?.actionType === 'task' ? 'Yes, Mark Complete' : `Yes, ${confirmPending === 'approve' ? 'Approve' : 'Reject'}`}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmPending(null)}
                        disabled={isSubmitting}
                        className="px-4 py-2.5 rounded-xl font-semibold text-sm bg-navy-light/30 text-gray-400 hover:text-white transition-all disabled:opacity-40"
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
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setConfirmPending('approve')}
                      disabled={!approveEnabled || isSubmitting}
                      title={!isDesignatedApprover ? `Only ${designatedApproverEmail} can approve at this level` : ''}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-all"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Approve & Sign
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmPending('reject')}
                      disabled={!rejectEnabled || isSubmitting}
                      title={!isDesignatedApprover ? `Only ${designatedApproverEmail} can reject at this level` : ''}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-all"
                    >
                      <XCircle className="w-4 h-4" /> Reject
                    </button>
                  </div>
                  </div>
                )}

                {/* What's still needed */}
                {signatureRequired && !signature && (
                  <div className="text-xs text-amber-400/80 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                    <p>→ Draw your signature above to enable Approve</p>
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
              <h4 className="text-sm font-semibold text-gray-300 mb-4">Approval Timeline</h4>
              <div className="space-y-0">
                {submission.approvalHistory.map((entry, i) => (
                  <div key={i} className="flex items-start gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        entry.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' :
                        entry.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                        'bg-amber-500/20 text-amber-400'
                      }`}>
                        {entry.status === 'approved' ? <CheckCircle2 className="w-4 h-4" /> :
                         entry.status === 'rejected' ? <XCircle className="w-4 h-4" /> :
                         <Clock className="w-4 h-4" />}
                      </div>
                      {i < submission.approvalHistory.length - 1 && (
                        <div className="w-px h-10 bg-navy-light/30" />
                      )}
                    </div>
                    <div className="pb-6">
                      {(() => {
                        const isGeneric = /^Level \d+ Approver$/.test(entry.approverName) || entry.approverName === 'Approver';
                        return (
                          <p className="text-sm font-medium text-white">
                            Level {entry.level} — {isGeneric && entry.status === 'pending'
                              ? <span className="text-amber-400 italic font-normal">Pending Review</span>
                              : <>
                                  {entry.approverName}
                                  {entry.approverEmail && !entry.approverName.includes('@') && (
                                    <span className="text-xs text-gray-400 font-normal ml-1">({entry.approverEmail})</span>
                                  )}
                                </>
                            }
                          </p>
                        );
                      })()}
                      <p className="text-xs text-gray-500 mt-0.5">
                        {entry.status === 'pending' ? 'Pending approval' : `${entry.status} on ${entry.date}`}
                      </p>
                      {entry.comments && <p className="text-xs text-gray-400 mt-1 italic">"{entry.comments}"</p>}
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
