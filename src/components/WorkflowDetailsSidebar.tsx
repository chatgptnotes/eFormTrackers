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
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/30 z-40"
          />

          {/* Sidebar */}
          <motion.div
            initial={{ x: 600 }}
            animate={{ x: 0 }}
            exit={{ x: 600 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-[600px] bg-navy-dark border-l border-navy-light/20 z-50 overflow-y-auto shadow-2xl"
          >
            {/* Header */}
            <div className="sticky top-0 bg-navy-dark border-b border-navy-light/20 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Workflow Details</h2>
                <p className="text-xs text-gray-500 mt-1">{submission?.referenceNumber}</p>
              </div>
              <button onClick={onClose} className="p-1 hover:bg-navy-light/20 rounded transition-colors">
                <X className="w-5 h-5 text-gray-400 hover:text-white" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              {/* Card 1: Process Activity Feed - Modern Enterprise Style */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest px-1">Process Timeline</h3>
                {expandedTasks.length === 0 ? (
                  <span className="text-xs text-slate-500 italic block px-4">No workflow steps found</span>
                ) : (
                  <div className="space-y-2">
                    {expandedTasks.map((task, idx) => {
                      const isCompleted = task.status === 'COMPLETED';
                      const isActive = task.status === 'ACTIVE';
                      const isPending = task.status === 'PENDING';
                      const emailMatch = user?.email && task.assigneeEmail?.toLowerCase() === user.email.toLowerCase();
                      const typeBadge = task.type === 'workflow_approval' ? 'Approval' : task.type === 'workflow_assign_task' ? 'Task' : task.type === 'workflow_assign_form' ? 'Form' : task.type;

                      // Status color & badge styling
                      const statusColor = isCompleted ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : isActive ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' : 'bg-slate-600/10 text-slate-400 border-slate-600/30';
                      const statusBgIcon = isCompleted ? 'bg-emerald-500/30' : isActive ? 'bg-blue-500/30' : 'bg-slate-600/20';
                      const iconColor = isCompleted ? 'text-emerald-400' : isActive ? 'text-blue-400' : 'text-slate-500';

                      return (
                        <div
                          key={task.taskId || idx}
                          className={`rounded-lg border transition-all ${
                            isActive
                              ? 'bg-slate-700/30 border-slate-600/50 shadow-lg shadow-blue-500/10'
                              : 'bg-slate-800/30 border-slate-700/30'
                          } p-4 hover:bg-slate-700/40 hover:border-slate-600/60`}
                        >
                          <div className="flex items-start gap-3">
                            {/* Icon/Avatar */}
                            <div className={`${statusBgIcon} rounded-lg p-2 flex-shrink-0 flex items-center justify-center`}>
                              {task.type === 'workflow_approval' ? (
                                <CheckCircle2 className={`w-5 h-5 ${iconColor}`} />
                              ) : task.type === 'workflow_assign_task' ? (
                                <ClipboardList className={`w-5 h-5 ${iconColor}`} />
                              ) : task.type === 'workflow_assign_form' ? (
                                <FileEdit className={`w-5 h-5 ${iconColor}`} />
                              ) : (
                                <Clock className={`w-5 h-5 ${iconColor}`} />
                              )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <h4 className="text-sm font-semibold text-white truncate">{task.name}</h4>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border whitespace-nowrap ${statusColor}`}>
                                  {isCompleted ? 'Complete' : isActive ? 'In Progress' : 'Pending'}
                                </span>
                              </div>

                              {task.assigneeName && (
                                <p className="text-xs text-slate-400 mb-2">
                                  {task.assigneeName}
                                  {task.assigneeEmail && <span className="text-slate-600"> • {task.assigneeEmail}</span>}
                                </p>
                              )}

                              {/* Type Badge */}
                              <div className="flex items-center gap-2 mb-3">
                                <span
                                  className={`text-[10px] px-2 py-1 rounded-full font-semibold border ${
                                    task.type === 'workflow_approval'
                                      ? 'bg-indigo-600/20 text-indigo-300 border-indigo-600/40'
                                      : task.type === 'workflow_assign_form'
                                      ? 'bg-cyan-600/20 text-cyan-300 border-cyan-600/40'
                                      : 'bg-amber-600/20 text-amber-300 border-amber-600/40'
                                  }`}
                                >
                                  {typeBadge}
                                </span>
                              </div>

                              {/* Action Buttons */}
                              <div className="flex flex-wrap gap-2">
                                {isCompleted ? (
                                  <>
                                    <button className="text-[11px] px-3 py-1.5 rounded-md bg-emerald-600/20 text-emerald-400 border border-emerald-600/40 hover:bg-emerald-600/30 transition-colors cursor-default flex items-center gap-1">
                                      <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                                    </button>
                                    {task.type === 'workflow_approval' && (
                                      <button
                                        onClick={() =>
                                          onFetchSignature?.(submission?.id || '', task.level || 0, task.taskId || '')
                                        }
                                        disabled={sigLoading === task.taskId}
                                        className="text-[11px] px-3 py-1.5 rounded-md bg-cyan-600/20 text-cyan-400 border border-cyan-600/40 hover:bg-cyan-600/30 disabled:opacity-50 transition-colors cursor-pointer"
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
                                  <span className="text-[11px] px-3 py-1.5 rounded-md bg-slate-600/10 text-slate-400 border border-slate-600/30 flex items-center gap-1">
                                    <Clock className="w-3.5 h-3.5" /> Awaiting
                                  </span>
                                ) : isActive && task.type === 'workflow_approval' ? (
                                  emailMatch ? (
                                    <>
                                      <button
                                        onClick={() => onTaskApprove?.(submission?.id || '')}
                                        disabled={taskActionLoading === submission?.id}
                                        className="text-[11px] px-3 py-1.5 rounded-md bg-emerald-600/20 text-emerald-400 border border-emerald-600/40 hover:bg-emerald-600/30 disabled:opacity-50 transition-colors cursor-pointer"
                                      >
                                        <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" /> Approve
                                      </button>
                                      <button
                                        onClick={() => onSetTaskRejecting?.(task.taskId || '')}
                                        disabled={taskActionLoading === submission?.id}
                                        className="text-[11px] px-3 py-1.5 rounded-md bg-red-600/20 text-red-400 border border-red-600/40 hover:bg-red-600/30 disabled:opacity-50 transition-colors cursor-pointer"
                                      >
                                        <XCircle className="w-3.5 h-3.5 inline mr-1" /> Reject
                                      </button>
                                    </>
                                  ) : (
                                    <span className="text-[11px] px-3 py-1.5 rounded-md bg-slate-600/10 text-slate-500 border border-slate-600/30 flex items-center gap-1">
                                      <Lock className="w-3.5 h-3.5" /> Not Assigned
                                    </span>
                                  )
                                ) : isActive && task.type === 'workflow_assign_task' ? (
                                  emailMatch ? (
                                    <button
                                      onClick={() => onOpenTaskLink?.(task)}
                                      disabled={!task.accessLink}
                                      className="text-[11px] px-3 py-1.5 rounded-md bg-amber-600/20 text-amber-400 border border-amber-600/40 hover:bg-amber-600/30 disabled:opacity-50 transition-colors cursor-pointer"
                                    >
                                      <ClipboardList className="w-3.5 h-3.5 inline mr-1" /> Open Task
                                    </button>
                                  ) : (
                                    <span className="text-[11px] px-3 py-1.5 rounded-md bg-slate-600/10 text-slate-500 border border-slate-600/30 flex items-center gap-1">
                                      <Lock className="w-3.5 h-3.5" /> Not Assigned
                                    </span>
                                  )
                                ) : isActive && task.type === 'workflow_assign_form' ? (
                                  emailMatch ? (
                                    <button
                                      onClick={() => onOpenTaskLink?.(task)}
                                      disabled={!task.accessLink}
                                      className="text-[11px] px-3 py-1.5 rounded-md bg-cyan-600/20 text-cyan-400 border border-cyan-600/40 hover:bg-cyan-600/30 disabled:opacity-50 transition-colors cursor-pointer"
                                    >
                                      <FileEdit className="w-3.5 h-3.5 inline mr-1" /> Fill Form
                                    </button>
                                  ) : (
                                    <span className="text-[11px] px-3 py-1.5 rounded-md bg-slate-600/10 text-slate-500 border border-slate-600/30 flex items-center gap-1">
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

              {/* Card 3: Form Submission Data */}
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
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
