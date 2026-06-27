import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, XCircle, Clock, Eye, Lock, ClipboardList, FileEdit, Loader2, ExternalLink } from 'lucide-react';
import { Submission, WorkflowTask } from '../types';

interface Props {
  submission: Submission | null;
  expandedTasks: WorkflowTask[];
  expandLoading?: string;
  taskActionLoading?: string;
  taskRejectingId?: string | null;
  taskRejectReason?: string;
  taskConfirmRejectId?: string | null;
  sigLoading?: string;
  user?: { email?: string } | null;
  onClose: () => void;
  onTaskApprove?: (submissionId: string) => void;
  onTaskReject?: (submissionId: string, reason: string) => void;
  onFetchSignature?: (submissionId: string, level: number, taskId: string) => void;
  onOpenTaskLink?: (task: WorkflowTask) => void;
  onCompleteTask?: (task: WorkflowTask) => void;
  onSetTaskRejecting?: (taskId: string | null) => void;
  onSetTaskRejectReason?: (reason: string) => void;
  onSetTaskConfirmReject?: (taskId: string | null) => void;
}

const LevelBadge = ({ level }: { level?: number | string }) => {
  if (!level) return <span className="text-[10px] text-gray-500">—</span>;
  return <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/15 text-blue-400">L{level}</span>;
};

function extractSignatureUrl(comments?: string): string | null {
  if (!comments) return null;
  const match = comments.match(/Signature:\s*(https?:\/\/[^\s|]+)/);
  return match ? match[1] : null;
}

export default function WorkflowDetailsModal({
  submission,
  expandedTasks,
  expandLoading,
  taskActionLoading,
  taskRejectingId,
  taskRejectReason = '',
  taskConfirmRejectId,
  sigLoading,
  user,
  onClose,
  onTaskApprove,
  onTaskReject,
  onFetchSignature,
  onOpenTaskLink,
  onCompleteTask,
  onSetTaskRejecting,
  onSetTaskRejectReason,
  onSetTaskConfirmReject,
}: Props) {
  const [signatureViewUrl, setSignatureViewUrl] = useState<string | null>(null);

  if (!submission) return null;

  const handleViewSignature = (task: WorkflowTask) => {
    if (!submission.approvalHistory) return;
    const approvalEntry = submission.approvalHistory.find(a => a.level === task.level && a.status === 'approved');
    if (approvalEntry && approvalEntry.comments) {
      const sigUrl = extractSignatureUrl(approvalEntry.comments);
      if (sigUrl) {
        setSignatureViewUrl(sigUrl);
        return;
      }
    }
    // Fallback: fetch from jf_signatures if available (for backward compatibility or if comments not synced)
    if (onFetchSignature) {
      onFetchSignature(submission.id, task.level, task.taskId);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        onClick={e => e.stopPropagation()}
        className="bg-white border border-slate-200 rounded-lg w-full max-w-5xl max-h-[90vh] overflow-y-auto shadow-xl"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{submission.title}</h2>
            <p className="text-sm text-slate-600 mt-1">{submission.referenceNumber}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded transition-colors">
            <X className="w-5 h-5 text-slate-400 hover:text-slate-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 bg-gradient-to-b from-slate-50 to-white">
          {/* 1. WORKFLOW STEPS */}
          {expandLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
              <span className="text-sm text-slate-600 ml-3">Loading workflow steps...</span>
            </div>
          ) : expandedTasks.length === 0 ? (
            <span className="text-xs text-slate-500 italic">No workflow steps found</span>
          ) : (
            <div className="w-full">
              <p className="text-xs uppercase tracking-widest text-slate-700 font-semibold mb-5">Workflow Steps</p>
              <div className="space-y-0">
                {expandedTasks.map((task, idx) => {
                  const isCompleted = task.status === 'COMPLETED';
                  const isActive = task.status === 'ACTIVE';
                  const isPending = task.status === 'PENDING';
                  const isLast = idx === expandedTasks.length - 1;
                  const emailMatch = user?.email && task.assigneeEmail?.toLowerCase() === user.email.toLowerCase();
                  const typeBadge = task.type === 'workflow_approval' ? 'Approval' : task.type === 'workflow_assign_task' ? 'Task' : task.type === 'workflow_assign_form' ? 'Form' : task.type;

                  return (
                    <div key={task.taskId || idx} className="flex items-start gap-5">
                      <div className="flex flex-col items-center flex-shrink-0 pt-1" style={{ minWidth: '24px' }}>
                        {isCompleted ? (
                          <div className="w-5 h-5 rounded-full bg-emerald-600 flex items-center justify-center shadow-lg">
                            <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                          </div>
                        ) : isActive ? (
                          <div className="w-5 h-5 rounded-full bg-amber-600 animate-pulse shadow-lg" />
                        ) : (
                          <div className="w-5 h-5 rounded-full border-2.5 border-teal-600/40 bg-navy-dark" />
                        )}
                        {!isLast && (
                          <div
                            className={`w-0.5 flex-1 transition-colors duration-300 ${isCompleted ? 'bg-emerald-600/50' : isActive ? 'bg-amber-600/40' : 'bg-teal-600/20'}`}
                            style={{ minHeight: '34px' }}
                          />
                        )}
                      </div>

                      <div className="flex-1 flex items-start justify-between pb-0 min-w-0 pt-0.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span
                              className={`text-base font-semibold transition-colors ${
                                isCompleted ? 'text-slate-600' : isActive ? 'text-slate-900' : 'text-slate-500'
                              }`}
                            >
                              {task.name}
                            </span>
                            <span
                              className={`text-xs px-2.5 py-1 rounded-lg font-medium border transition-colors ${
                                task.type === 'workflow_approval'
                                  ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
                                  : task.type === 'workflow_assign_form'
                                  ? 'bg-cyan-100 text-cyan-700 border-cyan-200'
                                  : 'bg-amber-100 text-amber-700 border-amber-200'
                              }`}
                            >
                              {typeBadge}
                            </span>
                          </div>
                          {task.assigneeName && (
                            <p className="text-xs text-gray-500 mt-2">
                              {task.assigneeName}
                              {task.assigneeEmail ? <span className="text-gray-600 ml-1">({task.assigneeEmail})</span> : ''}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0 ml-5 flex-wrap justify-end">
                          {isCompleted ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-semibold flex items-center gap-1.5 border border-emerald-200 hover:bg-emerald-200 transition-colors">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                              </span>
                              {task.type === 'workflow_approval' && (
                                <button
                                  onClick={() => handleViewSignature(task)}
                                  title="View Signature"
                                  className="px-3 py-1.5 rounded-lg bg-cyan-100 text-cyan-700 hover:bg-cyan-200 text-xs font-semibold flex items-center gap-1 border border-cyan-200 transition-colors cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" /> <span className="hidden sm:inline">View Sig</span>
                                </button>
                              )}
                            </div>
                          ) : isPending ? (
                            <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold flex items-center gap-1.5 border border-slate-200">
                              <Clock className="w-3.5 h-3.5" /> Waiting
                            </span>
                          ) : isActive && task.type === 'workflow_approval' ? (
                            emailMatch ? (
                              <div className="flex items-center gap-2">
                                {taskConfirmRejectId === task.taskId ? (
                                  <div className="flex items-center gap-1.5 rounded-lg bg-red-600/20 border border-red-600/40 px-3 py-1.5">
                                    <span className="text-xs text-red-400 font-semibold">Confirm reject?</span>
                                    <button
                                      onClick={() => onTaskReject?.(submission.id, taskRejectReason.trim())}
                                      disabled={taskActionLoading === submission.id}
                                      className="px-2.5 py-1 rounded bg-red-700 text-white text-xs font-semibold hover:bg-red-600 disabled:opacity-50 transition-colors cursor-pointer"
                                    >
                                      {taskActionLoading === submission.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Yes'}
                                    </button>
                                    <button
                                      onClick={() => {
                                        onSetTaskConfirmReject?.(null);
                                        onSetTaskRejectReason?.('');
                                        onSetTaskRejecting?.(null);
                                      }}
                                      className="px-2.5 py-1 rounded bg-gray-700 text-gray-300 text-xs font-semibold hover:bg-gray-600 transition-colors cursor-pointer"
                                    >
                                      No
                                    </button>
                                  </div>
                                ) : taskRejectingId === task.taskId ? (
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={taskRejectReason}
                                      onChange={e => onSetTaskRejectReason?.(e.target.value)}
                                      placeholder="Reason (optional)"
                                      className="bg-navy-dark/50 border border-red-600/40 rounded-lg px-3 py-1.5 text-xs text-gray-300 w-40 focus:outline-none focus:border-red-500/60 focus:ring-1 focus:ring-red-500/30"
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') onSetTaskConfirmReject?.(task.taskId || '');
                                      }}
                                    />
                                    <button
                                      onClick={() => onSetTaskConfirmReject?.(task.taskId || '')}
                                      className="px-3 py-1.5 rounded-lg bg-red-700 text-white text-xs font-semibold hover:bg-red-600 transition-colors cursor-pointer"
                                    >
                                      OK
                                    </button>
                                    <button
                                      onClick={() => {
                                        onSetTaskRejecting?.(null);
                                        onSetTaskRejectReason?.('');
                                      }}
                                      className="text-xs text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => onTaskApprove?.(submission.id)}
                                      disabled={taskActionLoading === submission.id}
                                      className="px-3.5 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 text-xs font-semibold flex items-center gap-1.5 border border-emerald-200 transition-colors cursor-pointer"
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                                    </button>
                                    <button
                                      onClick={() => onSetTaskRejecting?.(task.taskId || '')}
                                      disabled={taskActionLoading === submission.id}
                                      className="px-3.5 py-1.5 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 text-xs font-semibold flex items-center gap-1.5 border border-red-200 transition-colors cursor-pointer"
                                    >
                                      <XCircle className="w-3.5 h-3.5" /> Reject
                                    </button>
                                  </>
                                )}
                              </div>
                            ) : (
                              <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold flex items-center gap-1.5 border border-slate-200">
                                <Lock className="w-3.5 h-3.5" /> Not assigned
                              </span>
                            )
                          ) : isActive && task.type === 'workflow_assign_task' ? (
                            emailMatch ? (
                              <button
                                onClick={() => onCompleteTask?.(task)}
                                className="px-3.5 py-1.5 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 disabled:opacity-50 text-xs font-semibold flex items-center gap-1.5 border border-amber-200 transition-colors cursor-pointer"
                              >
                                <ClipboardList className="w-3.5 h-3.5" /> Complete Task
                              </button>
                            ) : (
                              <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold flex items-center gap-1.5 border border-slate-200">
                                <Lock className="w-3.5 h-3.5" /> Not assigned
                              </span>
                            )
                          ) : isActive && task.type === 'workflow_assign_form' ? (
                            emailMatch ? (
                              <button
                                onClick={() => onOpenTaskLink?.(task)}
                                className="px-3.5 py-1.5 rounded-lg bg-cyan-100 text-cyan-700 hover:bg-cyan-200 disabled:opacity-50 text-xs font-semibold flex items-center gap-1.5 border border-cyan-200 transition-colors cursor-pointer"
                              >
                                <FileEdit className="w-3.5 h-3.5" /> Complete Form
                              </button>
                            ) : (
                              <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold flex items-center gap-1.5 border border-slate-200">
                                <Lock className="w-3.5 h-3.5" /> Not assigned
                              </span>
                            )
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 2. CHILD FORMS TABLE */}
          {(() => {
            const childTasks = expandedTasks.filter(t => t.type === 'workflow_assign_task' || t.type === 'workflow_assign_form');
            if (childTasks.length === 0) return null;
            return (
              <div className="border-t border-navy-light/20 pt-4">
                <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-3">Child Forms in this Workflow</p>
                <div className="rounded-lg border border-navy-light/20 overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-navy-dark/40 border-b border-navy-light/20">
                        <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase w-10">#</th>
                        <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Form Name</th>
                        <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Type</th>
                        <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Assigned To</th>
                        <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Submission Data</th>
                        <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Level</th>
                        <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Status</th>
                        <th className="px-3 py-2 text-center text-[10px] font-bold text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {childTasks.map((task, childIdx) => {
                        const isCompleted = task.status === 'COMPLETED';
                        const isActive = task.status === 'ACTIVE';
                        const typeBadge = task.type === 'workflow_assign_task' ? 'Task' : 'Form';
                        const emailMatch = user?.email && task.assigneeEmail?.toLowerCase() === user.email.toLowerCase();
                        return (
                          <tr key={task.taskId || childIdx} className="border-b border-navy-light/10 bg-navy-dark/20 hover:bg-navy-light/5 border-l-2 border-l-gold/30">
                            <td className="px-3 py-2 text-xs text-gray-500 font-mono">{childIdx + 1}</td>
                            <td className="px-3 py-2"><p className="text-xs text-gray-300">{task.name}</p></td>
                            <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${typeBadge === 'Task' ? 'bg-orange-500/15 text-orange-400 border border-orange-500/20' : 'bg-blue-500/15 text-blue-400 border border-blue-500/20'}`}>{typeBadge}</span></td>
                            <td className="px-3 py-2"><p className="text-xs text-gray-300">{task.assigneeName}</p><p className="text-[10px] text-gray-500">{task.assigneeEmail}</p></td>
                            <td className="px-3 py-2">{task.formData && Object.keys(task.formData).length > 0 ? <div className="space-y-0.5 max-h-24 overflow-y-auto">{Object.values(task.formData).map((field, fi) => <p key={fi} className="text-[10px] text-gray-300 truncate max-w-[200px]"><span className="text-gray-500">{field.label}:</span> {field.value}</p>)}</div> : task.submittedBy ? <><p className="text-[10px] text-gray-300">{task.submittedBy}</p>{task.submittedByEmail && <p className="text-[10px] text-gray-500">{task.submittedByEmail}</p>}</> : <span className="text-[10px] text-gray-500 italic">—</span>}</td>
                            <td className="px-3 py-2"><LevelBadge level={task.level} /></td>
                            <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${isCompleted ? 'bg-emerald-500/15 text-emerald-400' : isActive ? 'bg-amber-500/15 text-amber-400' : 'bg-gray-500/15 text-gray-400'}`}>{task.status === 'COMPLETED' ? 'Completed' : task.status === 'ACTIVE' ? 'Active' : 'Pending'}</span></td>
                            <td className="px-3 py-2 text-center">{isActive && emailMatch && task.accessLink ? <a href={task.accessLink} target="_blank" rel="noopener noreferrer" className="text-xs text-gold hover:underline inline-flex items-center gap-1">{typeBadge === 'Task' ? <><ClipboardList className="w-3 h-3" /> View Task</> : <><FileEdit className="w-3 h-3" /> Complete Form</>}</a> : isCompleted ? <span className="text-[10px] text-gray-500">Done</span> : <span className="text-[10px] text-gray-500">—</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* 3. FORM SUBMISSION DATA */}
          {submission.formTableData && submission.formTableData.length > 0 && (
            <div className="border-t border-navy-light/20 pt-4">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-3">Form Submission Data</p>
              <div className="rounded-lg border border-navy-light/20 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-navy-dark/40 border-b border-navy-light/20">
                      {submission.formTableData.map((field, i) => (
                        <th key={i} className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase whitespace-nowrap">{field.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-navy-light/10 hover:bg-navy-light/5">
                      {submission.formTableData.map((field, i) => (
                        <td key={i} className="px-3 py-2 text-xs text-gray-300 whitespace-nowrap">{field.value || '—'}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* Signature Viewer Modal */}
      <AnimatePresence>
        {signatureViewUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setSignatureViewUrl(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl overflow-hidden w-full max-w-sm sm:max-w-md shadow-2xl"
            >
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Signature</h3>
                <button
                  onClick={() => setSignatureViewUrl(null)}
                  className="p-1 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-900"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 bg-gray-50 flex items-center justify-center" style={{ minHeight: '300px' }}>
                <img src={signatureViewUrl} alt="Signature" className="max-w-full max-h-[400px] object-contain" />
              </div>
              <div className="p-4 border-t border-gray-200 flex gap-2">
                <a
                  href={signatureViewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-700 font-medium text-sm transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
