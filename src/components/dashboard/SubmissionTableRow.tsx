import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, XCircle, MessageSquare, ExternalLink, Loader2,
  ClipboardList, FileEdit, Lock,
} from 'lucide-react';
import { Submission } from '../../types';
import { UserConfig } from '../../config/currentUser';
import CommentPanel from '../CommentPanel';
import { AgingCell, PendingWithCell, WorkflowStatusBadge, LevelProgress, PriorityDot, AmountCell } from './TableCells';

interface Props {
  sub: Submission;
  currentUser: UserConfig;
  commentingId: string | null;
  setCommentingId: (id: string | null) => void;
  rejectingId: string | null;
  setRejectingId: (id: string | null) => void;
  rejectReason: string;
  setRejectReason: (r: string) => void;
  confirmRejectId: string | null;
  setConfirmRejectId: (id: string | null) => void;
  actionLoading: string | null;
  taskUrlLoading: string | null;
  formUrlLoading: string | null;
  onOpenModal: (sub: Submission) => void;
  onReject: (sub: Submission) => void;
  onOpenTaskUrl: (sub: Submission) => void;
  onOpenFormUrl: (sub: Submission) => void;
  onSyncClick: (sub: Submission) => void;
}

export default function SubmissionTableRow({
  sub, currentUser, commentingId, setCommentingId,
  rejectingId, setRejectingId, rejectReason, setRejectReason,
  confirmRejectId, setConfirmRejectId,
  actionLoading, taskUrlLoading, formUrlLoading,
  onOpenModal, onReject, onOpenTaskUrl, onOpenFormUrl, onSyncClick,
}: Props) {
  return (
    <motion.tr
      key={sub.id}
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 50, height: 0 }}
      transition={{ duration: 0.3 }}
      className="border-b border-navy-light/10 hover:bg-navy-light/5"
    >
      {/* Enhancement 1: Priority dot before REF# */}
      <td className="px-4 py-3">
        <div className="flex items-center">
          <PriorityDot priority={sub.priority} />
          <div>
            <button
              onClick={() => onOpenModal(sub)}
              className="text-sm font-mono text-gold hover:underline block"
            >
              {sub.referenceNumber.split('-').pop()}
            </button>
            <a
              href={`https://eforms.mediaoffice.ae/inbox/${sub.formId}/${sub.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-gray-600 hover:text-gold flex items-center gap-0.5 mt-0.5"
            >
              <ExternalLink className="w-2.5 h-2.5" /> View in JotForm
            </a>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <a
          href={`https://eforms.mediaoffice.ae/inbox/${sub.formId}/${sub.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-white hover:text-gold hover:underline inline-flex items-center gap-1 group"
        >
          {sub.title}
          <ExternalLink className="w-3 h-3 text-gray-600 group-hover:text-gold transition-colors" />
        </a>
        <p className="text-xs text-gray-500">{sub.formTitle}</p>
      </td>
      {/* Enhancement 2: Amount column */}
      <td className="px-4 py-3 text-right">
        <AmountCell amount={sub.answers?.amount} />
      </td>
      <td className="px-4 py-3">
        <p className="text-sm text-gray-300">{sub.submittedBy.name}</p>
        <p className="text-xs text-gray-500">{sub.submittedBy.department}</p>
      </td>
      {/* Enhancement 5: Level Progress replaces LevelBadge */}
      <td className="px-4 py-3">
        <LevelProgress
          currentLevel={sub.currentApprovalLevel}
          approvalHistory={sub.approvalHistory}
          levelFieldMap={sub.levelFieldMap}
        />
      </td>
      <td className="px-4 py-3">
        <PendingWithCell submission={sub} onSyncClick={onSyncClick} />
      </td>
      {/* Enhancement 3: Enhanced aging with total days */}
      <td className="px-4 py-3">
        <AgingCell
          days={sub.daysAtCurrentLevel}
          totalDays={sub.totalDaysSinceSubmission}
          overallStatus={sub.overallStatus}
        />
      </td>
      <td className="px-4 py-3">
        <WorkflowStatusBadge submission={sub} />
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          {sub.currentApprovalLevel === 'completed' ? (
            <div className="flex flex-col items-start gap-1">
              <span className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-medium flex items-center gap-1 border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5" /> Approved & Completed
              </span>
              <a href={`https://eforms.mediaoffice.ae/inbox/${sub.formId}/${sub.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-gold flex items-center gap-1 transition-colors">
                <ExternalLink className="w-3 h-3" /> View in JotForm
              </a>
            </div>
          ) : sub.currentApprovalLevel === 'rejected' ? (
            <div className="flex flex-col items-start gap-1">
              <span className="px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium flex items-center gap-1 border border-red-500/20">
                <XCircle className="w-3.5 h-3.5" /> Rejected
              </span>
              <a href={`https://eforms.mediaoffice.ae/inbox/${sub.formId}/${sub.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-gold flex items-center gap-1 transition-colors">
                <ExternalLink className="w-3 h-3" /> View in JotForm
              </a>
            </div>
          ) : sub.actionType === 'task' ? (
            <button
              onClick={() => onOpenTaskUrl(sub)}
              disabled={taskUrlLoading === sub.id}
              className="px-2.5 py-1.5 rounded-lg bg-gold/20 text-gold hover:bg-gold/30 disabled:opacity-50 text-xs font-medium flex items-center gap-1 transition-colors"
            >
              {taskUrlLoading === sub.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardList className="w-3.5 h-3.5" />}
              View Task
            </button>
          ) : sub.actionType === 'form' ? (
            <button
              onClick={() => onOpenFormUrl(sub)}
              disabled={formUrlLoading === sub.id}
              className="px-2.5 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50 text-xs font-medium flex items-center gap-1 transition-colors"
            >
              {formUrlLoading === sub.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileEdit className="w-3.5 h-3.5" />}
              Complete Form
            </button>
          ) : (
            <>
              <div className="flex items-center justify-center gap-1.5 flex-wrap">
                {typeof sub.currentApprovalLevel === 'number' && (currentUser.isAdmin || currentUser.approvalLevels.includes(sub.currentApprovalLevel)) ? (
                  <button
                    onClick={() => onOpenModal(sub)}
                    disabled={actionLoading === sub.id}
                    className="px-2.5 py-1.5 rounded-lg bg-gold/20 text-gold hover:bg-gold/30 disabled:opacity-50 text-xs font-medium flex items-center gap-1 transition-colors"
                    title={"Review & Approve"}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {"Review & Approve"}
                  </button>
                ) : typeof sub.currentApprovalLevel === 'number' ? (
                  <span className="px-2.5 py-1.5 rounded-lg bg-gray-500/10 text-gray-600 text-xs font-medium flex items-center gap-1 border border-gray-500/10" title={`Your role cannot approve Level ${sub.currentApprovalLevel}`}>
                    <Lock className="w-3.5 h-3.5" /> Not your level
                  </span>
                ) : null}

                {confirmRejectId === sub.id ? (
                  <div className="flex items-center gap-1 rounded-lg bg-red-500/10 border border-red-500/30 px-2 py-1">
                    <span className="text-[11px] text-red-400">Confirm reject?</span>
                    <button
                      onClick={() => onReject(sub)}
                      disabled={actionLoading === sub.id}
                      className="px-2 py-0.5 rounded bg-red-600 text-white text-xs hover:bg-red-500 disabled:opacity-50 flex items-center gap-1"
                    >
                      {actionLoading === sub.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      Yes
                    </button>
                    <button onClick={() => { setConfirmRejectId(null); setRejectingId(sub.id); }} className="px-1.5 py-0.5 text-xs text-gray-500 hover:text-gray-300">
                      No
                    </button>
                  </div>
                ) : rejectingId === sub.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="Reason..."
                      autoFocus
                      className="w-28 px-2 py-1 text-xs rounded bg-navy-dark border border-red-500/30 text-white placeholder-gray-600 focus:outline-none"
                    />
                    <button
                      onClick={() => setConfirmRejectId(sub.id)}
                      disabled={false}
                      className="px-2 py-1 rounded bg-red-500/30 text-red-400 text-xs hover:bg-red-500/40 disabled:opacity-50"
                    >
                      OK
                    </button>
                    <button onClick={() => { setRejectingId(null); setRejectReason(''); }} className="px-1.5 py-1 text-xs text-gray-500 hover:text-gray-300">
                      X
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setRejectingId(sub.id)}
                    className="px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium flex items-center gap-1 border border-red-500/20 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </button>
                )}

                <button
                  onClick={() => setCommentingId(commentingId === sub.id ? null : sub.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 border transition-colors ${
                    commentingId === sub.id
                      ? 'bg-blue-500/30 text-blue-300 border-blue-500/30'
                      : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border-blue-500/20'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Comment
                </button>
              </div>

              {/* Secondary: View Task / View Form reference links */}
              <div className="flex items-center justify-center gap-3">
                {sub.taskUrl && (
                  <button
                    onClick={() => onOpenTaskUrl(sub)}
                    disabled={taskUrlLoading === sub.id}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-gold transition-colors disabled:opacity-50"
                  >
                    {taskUrlLoading === sub.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ClipboardList className="w-3 h-3" />}
                    {taskUrlLoading === sub.id ? 'Loading...' : 'View Task'}
                  </button>
                )}
                {sub.formUrl && (
                  <button
                    onClick={() => onOpenFormUrl(sub)}
                    disabled={formUrlLoading === sub.id}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-400 transition-colors disabled:opacity-50"
                  >
                    {formUrlLoading === sub.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileEdit className="w-3 h-3" />}
                    {formUrlLoading === sub.id ? 'Loading...' : 'Complete Form'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Inline Comment Panel */}
        <AnimatePresence>
          {commentingId === sub.id && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2"
            >
              <CommentPanel
                submissionId={sub.id}
                onClose={() => setCommentingId(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </td>
    </motion.tr>
  );
}
