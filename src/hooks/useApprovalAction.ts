import { useState, useRef, useEffect } from 'react';
import { Submission, ApprovalLevel } from '../types';
import jotformApi from '../services/jotformApi';
import { getUserConfig } from '../config/currentUser';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

type FieldMap = { statusField: string; approverField: string | null; overallStatusField: string | null };

function getFieldMap(submission: Submission, level: number): FieldMap | null {
  if (submission.levelFieldMap) {
    const lf = submission.levelFieldMap.find(m => m.level === level);
    if (lf) return { statusField: lf.statusFieldId, approverField: lf.approverFieldId, overallStatusField: lf.overallStatusFieldId };
  }
  return null;
}

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

// All approval levels require signature
const SIGNATURE_REQUIRED_LEVELS = [1, 2, 3, 4];

interface Props {
  submission: Submission | null;
  onUpdate?: (submissionId?: string, newLevel?: ApprovalLevel | 'completed' | 'rejected', newJotformStatus?: string) => void;
}

export function useApprovalAction({ submission, onUpdate }: Props) {
  const { user } = useAuth();
  const currentUser = getUserConfig(user?.email);

  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [pushResult, setPushResult] = useState<{ success: boolean; message: string } | null>(null);
  const [comment, setComment] = useState('');
  const [signature, setSignature] = useState('');
  const [confirmPending, setConfirmPending] = useState<'approve' | 'reject' | null>(null);
  const [ensuringFields, setEnsuringFields] = useState(false);
  const [dynamicFieldMap, setDynamicFieldMap] = useState<{ level: number; statusFieldId: string; approverFieldId: string | null; overallStatusFieldId: string | null }[] | null>(null);

  const isSubmitting = approving || rejecting || uploadingSignature || ensuringFields;

  const level = typeof submission?.currentApprovalLevel === 'number' ? submission.currentApprovalLevel : null;
  const signatureRequired = level !== null && SIGNATURE_REQUIRED_LEVELS.includes(level);

  const hasStaticFieldMap = submission !== null && level !== null && getFieldMap(submission, level) !== null;
  const supportsDirectApproval = hasStaticFieldMap || dynamicFieldMap !== null;

  // Who is the designated approver for the current level?
  const pendingEntry = submission
    ? (typeof submission.currentApprovalLevel === 'number'
        ? submission.approvalHistory.find(a => a.level === submission.currentApprovalLevel && a.status === 'pending')
        : submission.approvalHistory.find(a => a.status === 'pending'))
    : null;
  const designatedApproverEmail = pendingEntry?.approverName ?? '';
  const isDesignatedApprover = !!user?.email && (
    designatedApproverEmail.toLowerCase() === user.email.toLowerCase() ||
    currentUser.isAdmin === true
  );

  const approveEnabled = isDesignatedApprover && (!signatureRequired || signature !== '');
  const rejectEnabled = isDesignatedApprover;

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
    if (hasStaticFieldMap) return;
    if (dynamicFieldMap) return;

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

  const handleApproval = async (action: 'approve' | 'reject') => {
    if (!submission || typeof submission.currentApprovalLevel !== 'number') return;
    if (action === 'approve' && signatureRequired && !signature) return;

    action === 'approve' ? setApproving(true) : setRejecting(true);
    setPushResult(null);

    const lvl = submission.currentApprovalLevel;
    let fields = getFieldMap(submission, lvl);
    if (!fields && dynamicFieldMap) {
      const df = dynamicFieldMap.find(m => m.level === lvl);
      if (df) fields = { statusField: df.statusFieldId, approverField: df.approverFieldId, overallStatusField: df.overallStatusFieldId };
    }

    const actionLabel = action === 'approve' ? 'Approved' : 'Rejected';
    const timestamp = new Date().toLocaleString('en-AE', { timeZone: 'Asia/Dubai', hour12: true });

    // Upload signature
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

    const noteParts = [
      `Action: ${actionLabel}`,
      `By: ${currentUser.name} (${user?.email || 'unknown'})`,
      `Via: JotFlow`,
      `Date: ${timestamp}`,
      `Comment: ${comment.trim()}`,
      ...(signatureUrl ? [`Signature: ${signatureUrl}`] : []),
    ];
    const approverNote = noteParts.join(' | ');

    const maxLevel = submission.levelFieldMap
      ? Math.max(...submission.levelFieldMap.map(m => m.level))
      : submission.approvalHistory.length > 0
        ? Math.max(...submission.approvalHistory.map(h => h.level))
        : 4;
    const isLastLevel = lvl >= maxLevel;

    // Use workflow action API
    let result: { success: boolean; message: string };
    let instanceCompleted = false;
    try {
      const wfAction = action === 'approve' ? 'approve' : 'reject';
      const actionCtrl = new AbortController();
      const actionTimeout = setTimeout(() => actionCtrl.abort(), 30000);
      const res = await fetch('/api/workflow-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: submission.id,
          action: wfAction,
          comment: comment.trim() || approverNote,
          signature: signature || undefined,
        }),
        signal: actionCtrl.signal,
      });
      clearTimeout(actionTimeout);
      const data = await res.json();
      if (res.ok && data.ok) {
        result = { success: true, message: `${actionLabel} successfully via workflow engine` };
        instanceCompleted = data.instanceCompleted === true;
      } else {
        result = { success: false, message: data.error || `Workflow action failed: ${res.status}` };
      }
    } catch (err) {
      const msg = (err as Error).name === 'AbortError'
        ? 'Workflow action timed out. Please try again.'
        : `Workflow action error: ${(err as Error).message}`;
      result = { success: false, message: msg };
    }

    // Also update form fields as backup
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
      } catch {}
    }

    setPushResult(result);
    setApproving(false);
    setRejecting(false);

    if (result.success && onUpdate) {
      let newLevel: ApprovalLevel | 'completed' | 'rejected' | undefined;
      let newJotformStatus: string | undefined;
      if (action === 'reject') {
        newLevel = 'rejected';
        newJotformStatus = 'Rejected';
      } else if (instanceCompleted) {
        newLevel = 'completed';
        newJotformStatus = 'Completed';
      } else {
        newLevel = (lvl + 1) as ApprovalLevel;
        newJotformStatus = 'In Progress';
      }

      const sbStatus = action === 'reject' ? 'rejected' : (instanceCompleted ? 'completed' : 'in_progress');
      const sbLevel = action === 'reject' ? lvl : (instanceCompleted ? 999 : lvl + 1);
      supabase
        .from('jf_submissions')
        .update({
          current_level: sbLevel,
          status: sbStatus,
          approver_name: currentUser.name,
          last_synced: new Date().toISOString(),
        })
        .eq('jotform_submission_id', submission.id)
        .then(() => {});

      setTimeout(() => onUpdate(submission.id, newLevel, newJotformStatus), 500);
    }
  };

  return {
    approving, rejecting, uploadingSignature, isSubmitting,
    pushResult, comment, setComment, signature, setSignature,
    confirmPending, setConfirmPending,
    signatureRequired, approveEnabled, rejectEnabled,
    isDesignatedApprover, designatedApproverEmail,
    handleApproval, currentUser,
  };
}
