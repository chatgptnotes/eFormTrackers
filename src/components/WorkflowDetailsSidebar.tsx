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
              {/* Card 1: Workflow Steps */}
              <div className="bg-navy-dark/50 border border-navy-light/20 rounded-lg p-4">
                <h3 className="text-sm font-bold text-white mb-3 uppercase tracking-wide">Workflow Steps</h3>
                {expandedTasks.length === 0 ? (
                  <span className="text-xs text-gray-500 italic">No workflow steps found</span>
                ) : (
                  <div className="space-y-3">
                    {expandedTasks.map((task, idx) => {
                      const isCompleted = task.status === 'COMPLETED';
                      const isActive = task.status === 'ACTIVE';
                      const isPending = task.status === 'PENDING';
                      const isLast = idx === expandedTasks.length - 1;
                      const emailMatch = user?.email && task.assigneeEmail?.toLowerCase() === user.email.toLowerCase();
                      const typeBadge = task.type === 'workflow_approval' ? 'Approval' : task.type === 'workflow_assign_task' ? 'Task' : task.type === 'workflow_assign_form' ? 'Form' : task.type;

                      return (
                        <div key={task.taskId || idx} className="flex gap-3">
                          <div className="flex flex-col items-center flex-shrink-0">
                            {isCompleted ? <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> : isActive ? <div className="w-2.5 h-2.5 rounded-full bg-gold animate-pulse" /> : <div className="w-2.5 h-2.5 rounded-full border border-gray-600" />}
                            {!isLast && <div className={`w-0.5 h-12 ${isCompleted ? 'bg-emerald-500/40' : 'bg-gray-700'}`} />}
                          </div>

                          <div className="flex-1 pb-2">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className={`text-xs font-medium ${isCompleted ? 'text-gray-400' : isActive ? 'text-white' : 'text-gray-500'}`}>{task.name}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${task.type === 'workflow_approval' ? 'bg-purple-500/20 text-purple-400' : task.type === 'workflow_assign_form' ? 'bg-blue-500/20 text-blue-400' : 'bg-amber-500/20 text-amber-400'}`}>{typeBadge}</span>
                            </div>
                            {task.assigneeName && <p className="text-[11px] text-gray-500 mb-2">{task.assigneeName}{task.assigneeEmail ? ` (${task.assigneeEmail})` : ''}</p>}

                            <div className="flex flex-wrap gap-1">
                              {isCompleted ? (
                                <>
                                  <span className="px-2 py-1 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1"><CheckCircle2 className="w-2.5 h-2.5" /> Completed</span>
                                  {task.type === 'workflow_approval' && <button onClick={() => onFetchSignature?.(submission?.id || '', task.level || 0, task.taskId || '')} disabled={sigLoading === task.taskId} className="px-2 py-1 rounded text-[10px] font-medium bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20 disabled:opacity-50">{sigLoading === task.taskId ? <Loader2 className="w-2.5 h-2.5 animate-spin inline" /> : <Eye className="w-2.5 h-2.5 inline mr-0.5" />} Sig</button>}
                                </>
                              ) : isPending ? (
                                <span className="px-2 py-1 rounded text-[10px] font-medium bg-gray-500/10 text-gray-500 border border-gray-500/10 flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> Waiting</span>
                              ) : isActive && task.type === 'workflow_approval' ? (
                                emailMatch ? (
                                  <>
                                    <button onClick={() => onTaskApprove?.(submission?.id || '')} disabled={taskActionLoading === submission?.id} className="px-2 py-1 rounded text-[10px] font-medium bg-gold/20 text-gold hover:bg-gold/30 disabled:opacity-50"><CheckCircle2 className="w-2.5 h-2.5 inline mr-0.5" /> Approve</button>
                                    <button onClick={() => onSetTaskRejecting?.(task.taskId || '')} disabled={taskActionLoading === submission?.id} className="px-2 py-1 rounded text-[10px] font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50"><XCircle className="w-2.5 h-2.5 inline mr-0.5" /> Reject</button>
                                  </>
                                ) : (
                                  <span className="px-2 py-1 rounded text-[10px] font-medium bg-gray-500/10 text-gray-600 border border-gray-500/10 flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> Not assigned</span>
                                )
                              ) : isActive && task.type === 'workflow_assign_task' ? (
                                emailMatch ? (
                                  <button onClick={() => onOpenTaskLink?.(task)} disabled={!task.accessLink} className="px-2 py-1 rounded text-[10px] font-medium bg-gold/20 text-gold hover:bg-gold/30 disabled:opacity-50"><ClipboardList className="w-2.5 h-2.5 inline mr-0.5" /> View Task</button>
                                ) : (
                                  <span className="px-2 py-1 rounded text-[10px] font-medium bg-gray-500/10 text-gray-600 border border-gray-500/10"><Lock className="w-2.5 h-2.5 inline mr-0.5" /> Not assigned</span>
                                )
                              ) : isActive && task.type === 'workflow_assign_form' ? (
                                emailMatch ? (
                                  <button onClick={() => onOpenTaskLink?.(task)} disabled={!task.accessLink} className="px-2 py-1 rounded text-[10px] font-medium bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50"><FileEdit className="w-2.5 h-2.5 inline mr-0.5" /> Form</button>
                                ) : (
                                  <span className="px-2 py-1 rounded text-[10px] font-medium bg-gray-500/10 text-gray-600 border border-gray-500/10"><Lock className="w-2.5 h-2.5 inline mr-0.5" /> Not assigned</span>
                                )
                              ) : null}
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
