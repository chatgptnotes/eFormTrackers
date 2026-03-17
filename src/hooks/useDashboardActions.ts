import { useState } from 'react';
import { Submission } from '../types';
import { useApp } from '../contexts/AppContext';
import { getUserConfig } from '../config/currentUser';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useSubmissions } from './useSubmissions';

export function useDashboardActions(data: ReturnType<typeof useSubmissions>) {
  const { addAuditEntry } = useApp();
  const { user } = useAuth();
  const currentUser = getUserConfig(user?.email);

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);
  const [syncSubmission, setSyncSubmission] = useState<Submission | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [taskUrlLoading, setTaskUrlLoading] = useState<string | null>(null);
  const [formUrlLoading, setFormUrlLoading] = useState<string | null>(null);

  const pushToJotForm = async (sub: Submission, decision: 'approved' | 'rejected', reason?: string) => {
    if (typeof sub.currentApprovalLevel !== 'number') return;
    const action = decision === 'approved' ? 'approve' : 'reject';
    const res = await fetch('/api/workflow-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId: sub.id, action, comment: reason || '' }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Workflow action failed: ${res.status}`);
    }
  };

  const handleReject = async (sub: Submission) => {
    setActionLoading(sub.id);
    try {
      await pushToJotForm(sub, 'rejected', rejectReason.trim());
      addAuditEntry(sub.id, 'rejected', currentUser.name, `Rejected: ${rejectReason.trim()}`);
      data.optimisticUpdate(sub.id, { newLevel: 'rejected', newJotformStatus: 'Rejected', approverName: currentUser.name });
      supabase.from('jf_submissions').update({ current_level: sub.currentApprovalLevel, status: 'rejected', approver_name: currentUser.name, last_synced: new Date().toISOString() }).eq('jotform_submission_id', sub.id).then(() => {});
      setRejectReason('');
      setRejectingId(null);
      setRejectedIds(prev => new Set([...prev, sub.id]));
      setConfirmRejectId(null);
      setTimeout(() => data.refresh({ force: true }), 3000);
    } catch (err) {
      alert(`Rejection failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSyncConfirm = async (sub: Submission, action: 'approve' | 'reject') => {
    if (typeof sub.currentApprovalLevel !== 'number') return;
    setSyncLoading(true);
    try {
      const lvl = sub.currentApprovalLevel;
      const levelField = sub.levelFieldMap?.find(lf => lf.level === lvl);
      if (!levelField) throw new Error(`No field map for level ${lvl}`);

      const today = new Date();
      const dateStr = `${today.getMonth() + 1}-${String(today.getDate()).padStart(2, '0')}-${today.getFullYear()}`;
      const params = new URLSearchParams();
      params.set(`submission[${levelField.statusFieldId}]`, action === 'approve' ? 'Approved' : 'Rejected');
      if (levelField.approverFieldId) {
        params.set(`submission[${levelField.approverFieldId}]`, 'Synced via JotFlow');
      }
      const totalLevels = sub.levelFieldMap?.length || 1;
      const isLastLevel = lvl === totalLevels;
      const overallFieldId = levelField.overallStatusFieldId;
      if (overallFieldId) {
        params.set(`submission[${overallFieldId}]`,
          action === 'reject' ? 'Rejected' : isLastLevel ? 'Completed' : 'In Progress');
      }

      const res = await fetch(`/api/jotform-update?submissionId=${sub.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);

      supabase.from('jf_submissions')
        .update({ needs_sync: false, last_synced: new Date().toISOString() })
        .eq('jotform_submission_id', sub.id)
        .then(() => {});

      const newLevel = action === 'reject' ? 'rejected' as const
        : isLastLevel ? 'completed' as const
        : (lvl + 1) as 1 | 2 | 3 | 4;
      const newStatus = action === 'reject' ? 'Rejected' : isLastLevel ? 'Completed' : 'In Progress';
      data.optimisticUpdate(sub.id, { newLevel, newJotformStatus: newStatus, approverName: 'Synced via JotFlow', approvalDate: dateStr });
      addAuditEntry(sub.id, action === 'approve' ? 'approved' : 'rejected', 'JotFlow Sync', `Native JotForm action synced as ${action}`);

      setSyncSubmission(null);
      setTimeout(() => data.refresh({ force: true }), 3000);
    } catch (err) {
      alert(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncLoading(false);
    }
  };

  const openTaskUrl = async (sub: Submission) => {
    setTaskUrlLoading(sub.id);
    try {
      const res = await fetch(`/api/task-url?formId=${sub.formId}&submissionId=${sub.id}`);
      const data = await res.json();
      const url = data.taskUrl || sub.taskUrl;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      if (sub.taskUrl) window.open(sub.taskUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setTaskUrlLoading(null);
    }
  };

  const openFormUrl = async (sub: Submission) => {
    setFormUrlLoading(sub.id);
    try {
      const res = await fetch(`/api/form-url?formId=${sub.formId}&submissionId=${sub.id}`);
      const data = await res.json();
      const url = data.formUrl || sub.formUrl || sub.editLink;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      const url = sub.formUrl || sub.editLink;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setFormUrlLoading(null);
    }
  };

  return {
    rejectingId, setRejectingId,
    rejectReason, setRejectReason,
    confirmRejectId, setConfirmRejectId,
    syncSubmission, setSyncSubmission,
    syncLoading,
    approvedIds, rejectedIds,
    actionLoading,
    taskUrlLoading, formUrlLoading,
    pushToJotForm, handleReject, handleSyncConfirm,
    openTaskUrl, openFormUrl,
    currentUser,
  };
}
