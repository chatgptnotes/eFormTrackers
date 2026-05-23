import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, XCircle, Clock, Eye, Lock, ClipboardList, FileEdit, Loader2 } from 'lucide-react';
import { Submission, WorkflowTask } from '../types';

interface Props {
  isOpen: boolean;
  submission: Submission | null;
  expandedTasks: WorkflowTask[];
  expandLoading?: string;
  taskActionLoading?: string;
  taskRejectingId?: string | null;
  taskRejectReason?: string;
  taskConfirmRejectId?: string | null;
  sigLoading?: string;
  user?: { email?: string } | null;
  showOverlay?: boolean;
  isAbsolute?: boolean;
  onClose: () => void;
  onTaskApprove?: (submissionId: string) => void;
  onTaskReject?: (submissionId: string, reason: string) => void;
  onFetchSignature?: (submissionId: string, level: number, taskId: string) => void;
  onOpenTaskLink?: (task: WorkflowTask) => void;
  onSetTaskRejecting?: (taskId: string | null) => void;
  onSetTaskRejectReason?: (reason: string) => void;
  onSetTaskConfirmReject?: (taskId: string | null) => void;
}

const LevelBadge = ({ level }: { level?: number | string }) => {
  if (!level) return <span className="text-xs text-gray-500">—</span>;
  return <span className="px-2 py-1 rounded text-xs font-medium bg-blue-500/15 text-blue-400">L{level}</span>;
};

export default function WorkflowDetailsSidebar({
  isOpen,
  submission,
  expandedTasks,
  expandLoading,
  taskActionLoading,
  taskRejectingId,
  taskRejectReason = '',
  taskConfirmRejectId,
  sigLoading,
  user,
  showOverlay = true,
  isAbsolute = false,
  onClose,
  onTaskApprove,
  onTaskReject,
  onFetchSignature,
  onOpenTaskLink,
  onSetTaskRejecting,
  onSetTaskRejectReason,
  onSetTaskConfirmReject,
}: Props) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay - Optional */}
          {showOverlay && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }}
              className="fixed inset-0 bg-black/30 z-40 cursor-pointer pointer-events-auto"
            />
          )}

          {/* Sidebar - Responsive width, absolute or fixed */}
          <motion.div
            initial={{ x: 600 }}
            animate={{ x: 0 }}
            exit={{ x: 600 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={`${isAbsolute ? 'absolute' : 'fixed'} right-0 top-0 h-full w-[600px] md:w-[600px] sm:w-full bg-white border-l border-slate-200 z-50 overflow-y-auto shadow-xl`}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-5 flex items-center justify-between z-50">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Workflow Details</h2>
                <p className="text-xs text-slate-500 mt-1">{submission?.referenceNumber}</p>
              </div>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onClose();
                }}
                className="relative p-1 hover:bg-slate-100 rounded transition-colors cursor-pointer pointer-events-auto"
              >
                <X className="w-5 h-5 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6 bg-gradient-to-b from-slate-50 to-white">
              {/* Card 1: Process Timeline - Clean JotForm Style */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-widest">Process Timeline</h3>
                {expandLoading === submission?.id ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                    <span className="text-xs text-slate-500">Loading workflow steps...</span>
                  </div>
                ) : expandedTasks.length === 0 ? (
                  <span className="text-xs text-slate-500 italic block">No workflow steps found</span>
                ) : (
                  <div className="space-y-3">
                    {expandedTasks.map((task, idx) => {
                      const isCompleted = task.status === 'COMPLETED';
                      const isActive = task.status === 'ACTIVE';
                      const isPending = task.status === 'PENDING';
                      const emailMatch = user?.email && task.assigneeEmail?.toLowerCase() === user.email.toLowerCase();
                      const typeBadge = task.type === 'workflow_approval' ? 'Approval' : task.type === 'workflow_assign_task' ? 'Task' : task.type === 'workflow_assign_form' ? 'Form' : task.type;

                      // Status badge colors (clean, light style)
                      const statusBadge = isCompleted ? 'bg-emerald-100 text-emerald-700' : isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600';
                      const typeBadgeStyle = task.type === 'workflow_approval' ? 'bg-indigo-100 text-indigo-700' : task.type === 'workflow_assign_form' ? 'bg-cyan-100 text-cyan-700' : 'bg-amber-100 text-amber-700';
                      const avatarBg = isCompleted ? 'bg-emerald-500' : isActive ? 'bg-blue-500' : 'bg-slate-400';
                      const avatarIcon = task.type === 'workflow_approval' ? <CheckCircle2 className="w-5 h-5" /> : task.type === 'workflow_assign_task' ? <ClipboardList className="w-5 h-5" /> : task.type === 'workflow_assign_form' ? <FileEdit className="w-5 h-5" /> : <Clock className="w-5 h-5" />;

                      return (
                        <div
                          key={task.taskId || idx}
                          className="border-b border-slate-200 pb-3 last:border-b-0 last:pb-0 hover:bg-slate-50 -mx-6 px-6 py-3 transition-colors"
                        >
                          <div className="flex items-start gap-3">
                            {/* Avatar */}
                            <div className={`${avatarBg} rounded-lg p-2.5 flex-shrink-0 flex items-center justify-center text-white`}>
                              {avatarIcon}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              {/* Title & Status */}
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <h4 className="text-sm font-semibold text-slate-900">{task.name}</h4>
                                <span className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap text-[11px] ${statusBadge}`}>
                                  {isCompleted ? 'Complete' : isActive ? 'In Progress' : 'Pending'}
                                </span>
                              </div>

                              {/* Assignee */}
                              {task.assigneeName && (
                                <p className="text-xs text-slate-600 mb-2">
                                  {task.assigneeName}
                                  {task.assigneeEmail && <span className="text-slate-500"> • {task.assigneeEmail}</span>}
                                </p>
                              )}

                              {/* Type Badge */}
                              <div className="flex items-center gap-2 mb-3">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${typeBadgeStyle}`}>
                                  {typeBadge}
                                </span>
                              </div>

                              {/* Action Buttons */}
                              <div className="flex flex-wrap gap-2">
                                {isCompleted ? (
                                  <>
                                    <button className="text-[11px] px-3 py-1.5 rounded-md bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors cursor-default font-medium flex items-center gap-1">
                                      <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                                    </button>
                                    {task.type === 'workflow_approval' && (
                                      <button
                                        onClick={() =>
                                          onFetchSignature?.(submission?.id || '', task.level || 0, task.taskId || '')
                                        }
                                        disabled={sigLoading === task.taskId}
                                        className="text-[11px] px-3 py-1.5 rounded-md bg-cyan-100 text-cyan-700 hover:bg-cyan-200 disabled:opacity-50 transition-colors cursor-pointer font-medium"
                                      >
                                        {sigLoading === task.taskId ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" />
                                        ) : (
                                          <>
                                            <Eye className="w-3.5 h-3.5 inline mr-1" />
                                          </>
                                        )}
                                        Signature
                                      </button>
                                    )}
                                  </>
                                ) : isPending ? (
                                  <span className="text-[11px] px-3 py-1.5 rounded-md bg-slate-100 text-slate-600 font-medium flex items-center gap-1">
                                    <Clock className="w-3.5 h-3.5" /> Awaiting
                                  </span>
                                ) : isActive && task.type === 'workflow_approval' ? (
                                  emailMatch ? (
                                    <>
                                      <button
                                        onClick={() => onTaskApprove?.(submission?.id || '')}
                                        disabled={taskActionLoading === submission?.id}
                                        className="text-[11px] px-3 py-1.5 rounded-md bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 transition-colors cursor-pointer font-medium"
                                      >
                                        <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" /> Approve
                                      </button>
                                      <button
                                        onClick={() => onSetTaskRejecting?.(task.taskId || '')}
                                        disabled={taskActionLoading === submission?.id}
                                        className="text-[11px] px-3 py-1.5 rounded-md bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 transition-colors cursor-pointer font-medium"
                                      >
                                        <XCircle className="w-3.5 h-3.5 inline mr-1" /> Reject
                                      </button>
                                    </>
                                  ) : (
                                    <span className="text-[11px] px-3 py-1.5 rounded-md bg-slate-100 text-slate-600 font-medium flex items-center gap-1">
                                      <Lock className="w-3.5 h-3.5" /> Not Assigned
                                    </span>
                                  )
                                ) : isActive && task.type === 'workflow_assign_task' ? (
                                  emailMatch ? (
                                    <button
                                      onClick={() => onOpenTaskLink?.(task)}
                                      className="text-[11px] px-3 py-1.5 rounded-md bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors cursor-pointer font-medium"
                                    >
                                      <ClipboardList className="w-3.5 h-3.5 inline mr-1" /> Open Task
                                    </button>
                                  ) : (
                                    <span className="text-[11px] px-3 py-1.5 rounded-md bg-slate-100 text-slate-600 font-medium flex items-center gap-1">
                                      <Lock className="w-3.5 h-3.5" /> Not Assigned
                                    </span>
                                  )
                                ) : isActive && task.type === 'workflow_assign_form' ? (
                                  emailMatch ? (
                                    <button
                                      onClick={() => onOpenTaskLink?.(task)}
                                      className="text-[11px] px-3 py-1.5 rounded-md bg-cyan-100 text-cyan-700 hover:bg-cyan-200 transition-colors cursor-pointer font-medium"
                                    >
                                      <FileEdit className="w-3.5 h-3.5 inline mr-1" /> Fill Form
                                    </button>
                                  ) : (
                                    <span className="text-[11px] px-3 py-1.5 rounded-md bg-slate-100 text-slate-600 font-medium flex items-center gap-1">
                                      <Lock className="w-3.5 h-3.5" /> Not Assigned
                                    </span>
                                  )
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Card 2: Child Forms */}
              {(() => {
                const childTasks = expandedTasks.filter(t => t.type === 'workflow_assign_task' || t.type === 'workflow_assign_form');
                if (childTasks.length === 0) return null;
                return (
                  <div>
                    <h3 className="text-sm font-bold text-white mb-3 uppercase tracking-wide">Child Forms in Workflow</h3>
                    <div className="space-y-3">
                      {childTasks.map((task, idx) => {
                        const isCompleted = task.status === 'COMPLETED';
                        const typeBadge = task.type === 'workflow_assign_task' ? 'Task' : 'Form';
                        const emailMatch = user?.email && task.assigneeEmail?.toLowerCase() === user.email.toLowerCase();
                        return (
                          <div key={task.taskId || idx} className="bg-navy-dark/50 border border-navy-light/20 rounded-lg p-4">
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between items-start gap-2 pb-2 border-b border-navy-light/10">
                                <div>
                                  <p className="text-xs font-bold text-white">{idx + 1}. {task.name}</p>
                                </div>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${typeBadge === 'Task' ? 'bg-orange-500/15 text-orange-400' : 'bg-blue-500/15 text-blue-400'}`}>{typeBadge}</span>
                              </div>

                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Assigned To:</span>
                                  <span className="text-gray-300">{task.assigneeName || '—'}</span>
                                </div>
                                {task.assigneeEmail && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Email:</span>
                                    <span className="text-gray-300 text-right">{task.assigneeEmail}</span>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Level:</span>
                                  <LevelBadge level={task.level} />
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-gray-500">Status:</span>
                                  <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${isCompleted ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>{isCompleted ? 'Completed' : 'Active'}</span>
                                </div>
                              </div>

                              {task.formData && Object.keys(task.formData).length > 0 && (
                                <div className="pt-2 border-t border-navy-light/10">
                                  <p className="text-[10px] text-gray-500 font-semibold mb-2">Submission Data:</p>
                                  <div className="space-y-1">
                                    {Object.values(task.formData).map((field, fi) => (
                                      <div key={fi} className="text-[11px] text-gray-300">
                                        <span className="text-gray-500">{field.label}:</span> {field.value}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Card 3: Form Submission Data (legacy formTableData path) */}
              {submission?.formTableData && submission.formTableData.length > 0 && (
                <div className="bg-navy-dark/50 border border-navy-light/20 rounded-lg p-4">
                  <h3 className="text-sm font-bold text-white mb-3 uppercase tracking-wide">Form Submission Data</h3>
                  <div className="grid grid-cols-1 gap-2">
                    {submission.formTableData.map((field, i) => (
                      <div key={i} className="p-3 bg-navy-dark/40 rounded border border-navy-light/10">
                        <p className="text-[10px] text-gray-500 font-semibold mb-1 uppercase tracking-wide">{field.label}</p>
                        <p className="text-xs text-gray-300 break-words">{field.value || '—'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Card 4: Form Field Values (from DB row's answers column) —
                  renders for DB-mapped submissions that don't have formTableData. */}
              {submission?.answers && Object.keys(submission.answers).length > 0 && (
                <div className="bg-navy-dark/50 border border-navy-light/20 rounded-lg p-4">
                  <h3 className="text-sm font-bold text-white mb-3 uppercase tracking-wide">Form Field Values</h3>
                  <div className="grid grid-cols-1 gap-2">
                    {Object.entries(submission.answers).map(([key, value]) => (
                      <div key={key} className="p-3 bg-navy-dark/40 rounded border border-navy-light/10">
                        <p className="text-[10px] text-gray-500 font-semibold mb-1 uppercase tracking-wide">{key}</p>
                        <p className="text-xs text-gray-300 break-words">{String(value || '—')}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
