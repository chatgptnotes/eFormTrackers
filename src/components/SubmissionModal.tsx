import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, User, Calendar, Building2, FileText, Send, MessageSquare,
} from 'lucide-react';
import { Submission, ApprovalLevel } from '../types';
import { useApprovalAction } from '../hooks/useApprovalAction';
import { fetchApprovalThread, ApprovalThreadEntry } from '../services/workflowCache';
import ApprovalTimeline from './modal/ApprovalTimeline';
import ApprovalActionPanel from './modal/ApprovalActionPanel';
import TaskActionPanel from './modal/TaskActionPanel';
import FormActionPanel from './modal/FormActionPanel';

interface Props {
  submission: Submission | null;
  onClose: () => void;
  onUpdate?: (submissionId?: string, newLevel?: ApprovalLevel | 'completed' | 'rejected', newJotformStatus?: string) => void;
}

const levelColors: Record<string, string> = {
  '1': 'bg-blue-500',
  '2': 'bg-amber-500',
  '3': 'bg-purple-500',
  '4': 'bg-red-500',
  'completed': 'bg-emerald-500',
  'rejected': 'bg-gray-500',
};

export default function SubmissionModal({ submission, onClose, onUpdate }: Props) {
  const approval = useApprovalAction({ submission, onUpdate });

  // Lazy-load real approval thread when modal opens
  const [thread, setThread] = useState<ApprovalThreadEntry[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  useEffect(() => {
    if (!submission) { setThread([]); return; }
    setThreadLoading(true);
    fetchApprovalThread(submission.id)
      .then(setThread)
      .finally(() => setThreadLoading(false));
  }, [submission?.id]);

  // Re-fetch thread after a successful approval/reject action
  useEffect(() => {
    if (!submission || !approval.pushResult?.success) return;
    // Delay to allow JotForm to process the action before fetching
    const timer = setTimeout(() => {
      setThreadLoading(true);
      fetchApprovalThread(submission.id, true)
        .then(setThread)
        .finally(() => setThreadLoading(false));
    }, 3000);
    return () => clearTimeout(timer);
  }, [approval.pushResult, submission?.id]);

  const openTaskUrl = () => {
    if (!submission?.taskUrl) return;
    window.open(submission.taskUrl, '_blank', 'noopener,noreferrer');
  };

  const openFormUrl = () => {
    if (!submission?.formUrl) return;
    window.open(submission.formUrl, '_blank', 'noopener,noreferrer');
  };

  // Keyboard: Esc to close — blocked while submission is in progress
  useEffect(() => {
    if (!submission) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !approval.isSubmitting) onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [submission, onClose, approval.isSubmitting]);

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
        onClick={approval.isSubmitting ? undefined : onClose}
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
              disabled={approval.isSubmitting}
              className="p-2 rounded-lg hover:bg-navy-light/30 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              title={approval.isSubmitting ? 'Please wait until submission completes' : 'Close'}
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

                {submission.actionType === 'task' && (
                  <TaskActionPanel
                    isDesignatedApprover={approval.isDesignatedApprover}
                    designatedApproverEmail={approval.designatedApproverEmail}
                    isSubmitting={approval.isSubmitting}
                    approving={approval.approving}
                    comment={approval.comment}
                    setComment={approval.setComment}
                    setConfirmPending={approval.setConfirmPending}
                    pushResult={approval.pushResult}
                  />
                )}

                {submission.actionType === 'form' && (
                  <FormActionPanel onOpenFormUrl={openFormUrl} />
                )}

                {submission.actionType === 'approval' && (
                  <ApprovalActionPanel
                    submission={submission}
                    comment={approval.comment}
                    setComment={approval.setComment}
                    signature={approval.signature}
                    setSignature={approval.setSignature}
                    signatureRequired={approval.signatureRequired}
                    approveEnabled={approval.approveEnabled}
                    rejectEnabled={approval.rejectEnabled}
                    isDesignatedApprover={approval.isDesignatedApprover}
                    designatedApproverEmail={approval.designatedApproverEmail}
                    isSubmitting={approval.isSubmitting}
                    approving={approval.approving}
                    rejecting={approval.rejecting}
                    uploadingSignature={approval.uploadingSignature}
                    confirmPending={approval.confirmPending}
                    setConfirmPending={approval.setConfirmPending}
                    handleApproval={approval.handleApproval}
                    pushResult={approval.pushResult}
                  />
                )}
              </div>
            )}

            {/* Approval Timeline */}
            <ApprovalTimeline history={submission.approvalHistory} />

            {/* Comments / History from real approval thread */}
            {(threadLoading || thread.length > 0) && (
              <div>
                <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-gold" />
                  Comments / History
                </h4>
                {threadLoading ? (
                  <p className="text-xs text-gray-500 italic">Loading thread...</p>
                ) : (
                  <div className="space-y-3">
                    {thread.map((entry, i) => {
                      const actor = String(entry.actor || entry.user || entry.name || entry.author || 'Unknown');
                      const action = String(entry.action || entry.type || entry.event || '');
                      const comment = String(entry.comment || entry.message || entry.body || entry.text || '');
                      const timestamp = String(entry.timestamp || entry.date || entry.created_at || entry.time || '');
                      return (
                        <div key={i} className="bg-navy-light/20 rounded-lg p-3 border border-navy-light/10">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-white">{actor}</span>
                            {timestamp && <span className="text-xs text-gray-500">{timestamp}</span>}
                          </div>
                          {action && <span className="text-xs text-gold/80 font-medium">{action}</span>}
                          {comment && <p className="text-xs text-gray-400 mt-1">{comment}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>

      </motion.div>
    </AnimatePresence>
  );
}
