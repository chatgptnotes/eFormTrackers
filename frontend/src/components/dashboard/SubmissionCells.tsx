import { memo } from 'react';
import { CheckCircle2, XCircle, User, ClipboardList, FileEdit } from 'lucide-react';
import { Submission } from '../../types';

export const AgingCell = memo(function AgingCell({ days }: { days: number }) {
  const color = days > 14 ? 'text-red-400' : days > 7 ? 'text-orange-400' : days > 3 ? 'text-amber-400' : 'text-emerald-400';
  const barColor = days > 14 ? 'bg-red-500' : days > 7 ? 'bg-orange-500' : days > 3 ? 'bg-amber-500' : 'bg-emerald-500';
  const barWidth = Math.min(100, (days / 30) * 100);
  return (
    <div className="space-y-1">
      <span className={`text-sm font-bold ${color} ${days > 14 ? 'animate-pulse' : ''}`}>{days}d</span>
      <div className="h-1 w-16 rounded-full bg-navy-light/30 overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barWidth}%` }} />
      </div>
    </div>
  );
});

export const PendingWithCell = memo(function PendingWithCell({ submission, onSyncClick }: { submission: Submission; onSyncClick?: (sub: Submission) => void }) {
  const { currentApprovalLevel, approvalHistory, actionType } = submission;

  if (currentApprovalLevel === 'completed') {
    return (
      <div className="flex items-center gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5 text-white" />
        <span className="text-xs text-white font-medium">Completed</span>
      </div>
    );
  }
  if (currentApprovalLevel === 'rejected') {
    return (
      <div className="flex items-center gap-1.5">
        <XCircle className="w-3.5 h-3.5 text-red-400" />
        <span className="text-xs text-red-400 font-medium">Rejected</span>
      </div>
    );
  }

  const pendingEntry = typeof currentApprovalLevel === 'number'
    ? approvalHistory.find(a => a.level === currentApprovalLevel && a.status === 'pending')
    : approvalHistory.find(a => a.status === 'pending');

  const currentEntry = typeof currentApprovalLevel === 'number'
    ? approvalHistory.find(a => a.level === currentApprovalLevel)
    : null;

  if (!pendingEntry) {
    if (currentEntry && currentEntry.status !== 'pending') {
      return (
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <div>
            <p className="text-xs text-emerald-400 font-medium">
              {currentEntry.status === 'approved' ? 'Approved' : 'Rejected'}
            </p>
            <p className="text-[10px] text-gray-500">by {currentEntry.approverName}</p>
          </div>
        </div>
      );
    }
    return <span className="text-gray-600 text-xs">--</span>;
  }

  const isGenericFallback = /^Level \d+ Approver$/.test(pendingEntry.approverName) || pendingEntry.approverName === 'Approver';
  const isEmail = pendingEntry.approverName.includes('@');
  const displayEmail = pendingEntry.approverEmail || (isEmail ? pendingEntry.approverName : '');
  const displayName = isGenericFallback
    ? ''
    : isEmail ? pendingEntry.approverName.split('@')[0] : pendingEntry.approverName;

  const aType = actionType as string;
  const stepLabel = aType === 'task' ? 'Task' : aType === 'form' ? 'Form Review' : 'Approval';

  return (
    <div className="flex items-center gap-2">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 shrink-0 ${
        aType === 'task' ? 'bg-gold/20' : aType === 'form' ? 'bg-blue-500/20' : 'bg-purple-500/20'
      }`}>
        {aType === 'task' ? <ClipboardList className="w-3.5 h-3.5 text-gold" /> :
         aType === 'form' ? <FileEdit className="w-3.5 h-3.5 text-blue-400" /> :
         <User className="w-3.5 h-3.5 text-purple-400" />}
      </div>
      <div className="min-w-0">
        {displayName ? (
          <>
            <p className="text-sm text-white leading-tight truncate max-w-[160px]" title={pendingEntry.approverName}>{displayName}</p>
            {displayEmail && !displayName.includes('@') && (
              <p className="text-[10px] text-gray-500 truncate max-w-[160px]" title={displayEmail}>{displayEmail}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-amber-400 italic">{stepLabel} Pending</p>
        )}
        <p className="text-xs text-gray-500">Level {pendingEntry.level} · {stepLabel}</p>
      </div>
    </div>
  );
});

export const WorkflowStatusBadge = memo(function WorkflowStatusBadge({ submission }: { submission: Submission }) {
  const { currentApprovalLevel, actionType, approvalHistory } = submission;

  if (currentApprovalLevel === 'completed') {
    return <span className="text-xs font-medium text-emerald-400">Completed</span>;
  }
  if (currentApprovalLevel === 'rejected') {
    return <span className="text-xs font-medium text-red-400">Rejected</span>;
  }

  const level = typeof currentApprovalLevel === 'number' ? currentApprovalLevel : 1;
  const hasApproved = approvalHistory.some(h => h.status === 'approved');

  if (actionType === 'task') {
    return <span className="text-xs font-medium text-amber-400">L{level} Task Pending</span>;
  }
  if (actionType === 'form') {
    return <span className="text-xs font-medium text-blue-400">Form Pending</span>;
  }

  if (hasApproved) {
    return <span className="text-xs font-medium text-indigo-400">L{level} Approval Pending</span>;
  }
  return <span className="text-xs font-medium text-amber-400">L{level} Approval Pending</span>;
});

export const StatusBadge = memo(function StatusBadge({ status }: { status: string }) {
  const lower = (status || '').toLowerCase();
  const styles: Record<string, string> = {
    'pending': 'text-amber-400',
    'in progress': 'text-blue-400',
    'completed': 'text-emerald-400',
    'approved': 'text-emerald-400',
    'rejected': 'text-red-400',
    'denied': 'text-red-400',
  };
  const matched = Object.entries(styles).find(([key]) => lower.includes(key));
  const colorClass = matched ? matched[1] : 'text-gray-400';
  return (
    <span className={`text-xs font-medium ${colorClass}`}>
      {status || 'Unknown'}
    </span>
  );
});

export const LevelBadge = memo(function LevelBadge({ level }: { level: number | 'completed' | 'rejected' }) {
  if (level === 'completed') return <span className="text-xs font-medium text-emerald-400">Completed</span>;
  if (level === 'rejected') return <span className="text-xs font-medium text-red-400">Rejected</span>;
  const colors: Record<number, string> = {
    1: 'text-blue-400',
    2: 'text-amber-400',
    3: 'text-purple-400',
    4: 'text-red-400',
    5: 'text-teal-400',
    6: 'text-pink-400',
    7: 'text-indigo-400',
    8: 'text-orange-400',
    9: 'text-cyan-400',
    10: 'text-lime-400',
  };
  const colorClass = colors[level] || 'text-gray-400';
  return (
    <span className={`text-xs font-medium ${colorClass}`}>
      L{level}
    </span>
  );
});

export function isAssignedToSpecificPerson(submission: Submission): boolean {
  const { currentApprovalLevel, approvalHistory } = submission;
  const pendingEntry = typeof currentApprovalLevel === 'number'
    ? approvalHistory.find(a => a.level === currentApprovalLevel && a.status === 'pending')
    : approvalHistory.find(a => a.status === 'pending');
  if (!pendingEntry) return false;
  const isGenericFallback = /^Level \d+ Approver$/.test(pendingEntry.approverName) || pendingEntry.approverName === 'Approver';
  return !isGenericFallback;
}
