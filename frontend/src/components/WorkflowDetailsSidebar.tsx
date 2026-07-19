import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, XCircle, Clock, Eye, Lock, ClipboardList, FileEdit, Loader2, PenLine } from 'lucide-react';
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

function usernameFromEmail(email?: string) {
  const prefix = String(email || '').split('@')[0].trim();
  return prefix || '—';
}

function taskUserDetails(task: WorkflowTask, submission: Submission | null, isActive: boolean, isCompleted: boolean) {
  const mailId = task.assigneeEmail
    || (isActive ? submission?.pendingApproverEmail : '')
    || (isCompleted ? task.submittedByEmail : '')
    || '';
  const username = task.assigneeName
    || (isActive ? submission?.pendingApproverName : '')
    || (isCompleted ? task.submittedBy : '')
    || usernameFromEmail(mailId);

  return {
    username: username || '—',
    mailId: mailId || '—',
  };
}

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
  const overlayClass = isAbsolute ? '2xl:hidden' : '';
  const panelClass = isAbsolute ? 'fixed 2xl:absolute h-dvh 2xl:h-full z-[70] 2xl:z-50' : 'fixed h-dvh z-[70]';
  const flowTasks = [...expandedTasks].sort((a, b) => {
    const order: Record<string, number> = { COMPLETED: 0, ACTIVE: 1, PENDING: 2 };
    const diff = (order[a.status ?? ''] ?? 3) - (order[b.status ?? ''] ?? 3);
    return diff || (a.level ?? 0) - (b.level ?? 0);
  });
  const activeStepIndex = Math.max(0, flowTasks.findIndex(task => task.status === 'ACTIVE'));
  const activeFlowProgress = flowTasks.length > 1 ? activeStepIndex / (flowTasks.length - 1) : 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay - Optional */}
          {(showOverlay || isAbsolute) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }}
              className={`fixed inset-0 bg-black/30 z-[65] cursor-pointer pointer-events-auto ${overlayClass}`}
            />
          )}

          {/* Sidebar - Responsive width, absolute or fixed */}
          <motion.div
            initial={{ x: 480 }}
            animate={{ x: 0 }}
            exit={{ x: 480 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={`${panelClass} ui-surface right-0 top-0 w-screen max-w-[480px] bg-white border-l border-slate-200 overflow-y-auto shadow-xl`}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-5 sm:px-6 flex items-center justify-between gap-3 z-50">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold text-slate-900">Workflow Details</h2>
                <p className="truncate text-xs text-slate-500 mt-1">{submission?.referenceNumber}</p>
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
                className="relative flex-shrink-0 p-1 hover:bg-slate-100 rounded transition-colors cursor-pointer pointer-events-auto"
              >
                <X className="w-5 h-5 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 sm:p-6 space-y-6 bg-gradient-to-b from-slate-50 to-white">
              {/* Pending With — surfaces current approver name + email at the
                  top of the sidebar (most useful on Dashboard where the
                  user is looking at pending submissions). Hidden for completed/
                  rejected rows (no one is currently pending) and for rows from
                  data-collection forms with no approval workflow. */}
              {submission && submission.currentApprovalLevel !== 'completed' &&
               submission.currentApprovalLevel !== 'rejected' &&
               (submission.pendingApproverName || submission.pendingApproverEmail) && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-blue-700">Pending with</p>
                  <p className="text-base font-semibold text-slate-900">
                    {submission.pendingApproverName || '—'}
                  </p>
                  {submission.pendingApproverEmail && (
                    <p className="mt-0.5 text-xs font-mono text-slate-600">
                      {submission.pendingApproverEmail}
                    </p>
                  )}
                </div>
              )}

              {/* Card 1: Process Timeline - Clean JotForm Style */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-widest">Process Timeline</h3>
                {expandLoading === submission?.id ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                    <span className="text-xs text-slate-500">Loading workflow steps...</span>
                  </div>
                ) : expandedTasks.length === 0 ? (
                  <div className="text-xs text-slate-500 italic">
                    <p>This form has no approval workflow.</p>
                    <p className="mt-1 text-slate-400">Submissions are collected directly without an approval chain — see Form Field Values below for the submitted data.</p>
                  </div>
                ) : (
                  <div className="relative space-y-0 before:absolute before:bottom-8 before:left-5 before:top-8 before:w-px before:bg-slate-200">
                    <div aria-hidden="true" className="pointer-events-none absolute bottom-8 left-5 top-8 z-10 w-px">
                      <motion.span className="absolute inset-0 origin-top bg-blue-500 shadow-[0_0_10px_rgba(37,99,235,0.65)]"
                        initial={{ scaleY: 0 }} animate={{ scaleY: activeFlowProgress }} transition={{ duration: 1.8, ease: 'easeInOut' }} />
                      <motion.span className="absolute -left-[3px] h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_12px_rgba(37,99,235,0.95)]"
                        initial={{ top: '0%', opacity: 0 }} animate={{ top: `${activeFlowProgress * 100}%`, opacity: 1 }} transition={{ duration: 1.8, ease: 'easeInOut' }} />
                    </div>
                    {flowTasks.map((task, idx) => {
                      const isCompleted = task.status === 'COMPLETED';
                      const isActive = task.status === 'ACTIVE';
                      const isPending = task.status === 'PENDING';
                      const emailMatch = user?.email && task.assigneeEmail?.toLowerCase() === user.email.toLowerCase();
                      const typeBadge = task.type === 'workflow_approval' ? 'Approval' : task.type === 'workflow_assign_task' ? 'Task' : task.type === 'workflow_assign_form' ? 'Form' : task.type;

                      const details = taskUserDetails(task, submission || null, isActive, isCompleted);

                      // Status badge colors (clean, light style)
                      const statusBadge = isCompleted ? 'bg-emerald-100 text-emerald-700' : isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600';
                      const typeBadgeStyle = task.type === 'workflow_approval' ? 'bg-indigo-100 text-indigo-700' : task.type === 'workflow_assign_form' ? 'bg-cyan-100 text-cyan-700' : 'bg-amber-100 text-amber-700';
                      const avatarBg = isCompleted ? 'bg-emerald-500' : isActive ? 'bg-blue-500' : 'bg-slate-400';
                      const avatarIcon = task.type === 'workflow_approval' ? <CheckCircle2 className="w-5 h-5" /> : task.type === 'workflow_assign_task' ? <ClipboardList className="w-5 h-5" /> : task.type === 'workflow_assign_form' ? <FileEdit className="w-5 h-5" /> : <Clock className="w-5 h-5" />;

                      return (
                        <motion.div
                          key={task.taskId || idx}
                          initial={{ opacity: 0, x: 16 }}
                          animate={{ opacity: 1, x: 0 }}
                          whileHover={{ x: 4 }}
                          transition={{ delay: idx * 0.08, duration: 0.24 }}
                        className="relative py-1 pl-14"
                      >
                          <div className="flex items-start">
                            {/* Avatar */}
                            <motion.div
                              animate={isActive ? { scale: [1, 1.08, 1], boxShadow: ['0 0 0 0 rgba(59,130,246,0)', '0 0 0 7px rgba(59,130,246,0.14)', '0 0 0 0 rgba(59,130,246,0)'] } : undefined}
                              transition={isActive ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : undefined}
                              className={`workflow-node absolute left-0 top-5 z-10 ${avatarBg} rounded-xl p-2.5 flex-shrink-0 flex items-center justify-center text-white`}
                            >
                              {avatarIcon}
                            </motion.div>

                            {/* Content */}
                            <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
                              {/* Title & Status */}
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <h4 className="text-sm font-semibold text-slate-900">{task.name}</h4>
                                <span className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap text-[11px] ${statusBadge}`}>
                                  {isCompleted ? 'Complete' : isActive ? 'In Progress' : 'Pending'}
                                </span>
                              </div>

                              <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                                <div className="flex items-start justify-between gap-3">
                                  <span className="font-semibold text-slate-500">Username</span>
                                  <span className="text-right font-semibold text-slate-800 break-all">{details.username}</span>
                                </div>
                                <div className="mt-1 flex items-start justify-between gap-3">
                                  <span className="font-semibold text-slate-500">Mail ID</span>
                                  <span className="text-right font-mono text-slate-700 break-all">{details.mailId}</span>
                                </div>
                              </div>

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
                                    <button
                                      onClick={() => onTaskApprove?.(submission?.id || '')}
                                      disabled={taskActionLoading === submission?.id}
                                      className="text-[11px] px-3 py-1.5 rounded-md bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 transition-colors cursor-pointer font-medium"
                                    >
                                      <PenLine className="w-3.5 h-3.5 inline mr-1" /> Review &amp; Sign
                                    </button>
                                  ) : (
                                    <span className="text-[11px] px-3 py-1.5 rounded-md bg-slate-100 text-slate-600 font-medium flex items-center gap-1">
                                      <Lock className="w-3.5 h-3.5" /> Not Assigned
                                    </span>
                                  )
                                ) : isActive && task.type === 'workflow_assign_task' ? (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {emailMatch ? (
                                      <button
                                        onClick={() => onTaskApprove?.(submission?.id || '')}
                                        className="text-[11px] px-3 py-1.5 rounded-md bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors cursor-pointer font-medium"
                                      >
                                        <ClipboardList className="w-3.5 h-3.5 inline mr-1" /> Mark Complete
                                      </button>
                                    ) : (
                                      <span className="text-[11px] px-3 py-1.5 rounded-md bg-slate-100 text-slate-600 font-medium flex items-center gap-1">
                                        <Lock className="w-3.5 h-3.5" /> Not Assigned
                                      </span>
                                    )}
                                  </div>
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
                        </motion.div>
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
                    <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-700">Child Forms in Workflow</h3>
                    <div className="space-y-3">
	                      {childTasks.map((task, idx) => {
	                        const isCompleted = task.status === 'COMPLETED';
	                        const typeBadge = task.type === 'workflow_assign_task' ? 'Task' : 'Form';
	                        const emailMatch = user?.email && task.assigneeEmail?.toLowerCase() === user.email.toLowerCase();
	                        const details = taskUserDetails(task, submission || null, task.status === 'ACTIVE', isCompleted);
	                        return (
                          <div key={task.taskId || idx} className="rounded-xl border border-slate-200 bg-white p-4">
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between items-start gap-2 border-b border-slate-100 pb-2">
                                <div>
                                  <p className="text-sm font-bold text-slate-900">{idx + 1}. {task.name}</p>
                                </div>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${typeBadge === 'Task' ? 'bg-orange-500/15 text-orange-400' : 'bg-blue-500/15 text-blue-400'}`}>{typeBadge}</span>
                              </div>

	                              <div className="space-y-1 text-xs">
	                                <div className="flex justify-between">
                                  <span className="text-slate-500">Username:</span>
                                  <span className="text-right text-slate-800 break-all">{details.username}</span>
	                                </div>
	                                <div className="flex justify-between gap-4">
                                  <span className="text-slate-500">Mail ID:</span>
                                  <span className="text-right font-mono text-slate-700 break-all">{details.mailId}</span>
	                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Level:</span>
                                  <LevelBadge level={task.level} />
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-slate-500">Status:</span>
                                  <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${isCompleted ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>{isCompleted ? 'Completed' : 'Active'}</span>
                                </div>
                              </div>

                              {task.formData && Object.keys(task.formData).length > 0 && (
                                <div className="border-t border-slate-100 pt-2">
                                  <p className="mb-2 text-[10px] font-semibold text-slate-500">Submission Data:</p>
                                  <div className="space-y-1">
                                    {Object.values(task.formData).map((field, fi) => (
                                      <div key={fi} className="text-[11px] text-slate-700">
                                        <span className="text-slate-500">{field.label}:</span> {field.value}
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
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-700">Form Submission Data</h3>
                  <div className="grid grid-cols-1 gap-2">
                    {submission.formTableData.map((field, i) => (
                      <div key={i} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{field.label}</p>
                        <p className="text-xs text-slate-800 break-words">{field.value || '—'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Card 4: Form Field Values (from DB row's answers column) —
                  renders for DB-mapped submissions that don't have formTableData. */}
              {submission?.answers && Object.keys(submission.answers).length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-700">Form Field Values</h3>
                  <div className="grid grid-cols-1 gap-2">
                    {Object.entries(submission.answers).map(([key, value]) => (
                      <div key={key} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{key}</p>
                        <p className="text-xs text-slate-800 break-words">{String(value || '—')}</p>
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
