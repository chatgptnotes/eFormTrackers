import {
  CheckCircle2, XCircle, User, ClipboardList, FileEdit, Clock,
} from 'lucide-react';
import { Submission } from '../../types';

// ─── Enhancement 1: Priority Indicator Dot ──────────────────────────────────
export function PriorityDot({ priority }: { priority: string }) {
  if (priority === 'urgent') {
    return <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse mr-1.5 flex-shrink-0" title="Urgent" />;
  }
  if (priority === 'high') {
    return <span className="inline-block w-2 h-2 rounded-full bg-orange-500 mr-1.5 flex-shrink-0" title="High Priority" />;
  }
  return null;
}

// ─── Enhancement 2: Amount Cell ─────────────────────────────────────────────
export function AmountCell({ amount }: { amount?: string }) {
  if (!amount) {
    return <span className="text-gray-600 text-sm">—</span>;
  }
  const num = parseFloat(amount.replace(/[^0-9.]/g, ''));
  const formatted = isNaN(num) ? amount : `AED ${num.toLocaleString()}`;
  const isLarge = !isNaN(num) && num > 50000;
  return (
    <span className={`text-sm font-medium tabular-nums ${isLarge ? 'text-gold' : 'text-gray-300'}`}>
      {formatted}
    </span>
  );
}

// ─── Enhancement 3: Enhanced Aging Cell ─────────────────────────────────────
export function AgingCell({ days, totalDays, overallStatus }: { days: number; totalDays?: number; overallStatus?: string }) {
  const color = days > 14 ? 'text-red-400' : days > 7 ? 'text-orange-400' : days > 3 ? 'text-amber-400' : 'text-emerald-400';
  const barColor = days > 14 ? 'bg-red-500' : days > 7 ? 'bg-orange-500' : days > 3 ? 'bg-amber-500' : 'bg-emerald-500';
  const barWidth = Math.min(100, (days / 30) * 100);

  const statusColor = overallStatus === 'critical' ? 'text-red-400' : overallStatus === 'delayed' ? 'text-orange-400' : 'text-emerald-400';

  return (
    <div className="space-y-1">
      <span className={`text-sm font-bold ${color} ${days > 14 ? 'animate-pulse' : ''}`}>{days}d</span>
      <div className="h-1 w-16 rounded-full bg-navy-light/30 overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barWidth}%` }} />
      </div>
      {totalDays != null && totalDays !== days && (
        <p className={`text-[10px] ${statusColor}`}>
          Total: {totalDays}d · {overallStatus || 'on-track'}
        </p>
      )}
    </div>
  );
}

// ─── Enhancement 6: Pending With Cell (with hover tooltip) ──────────────────
export function PendingWithCell({ submission, onSyncClick }: { submission: Submission; onSyncClick?: (sub: Submission) => void }) {
  const { currentApprovalLevel, approvalHistory, actionType } = submission;

  // Completed or rejected — nothing pending
  if (currentApprovalLevel === 'completed') {
    return (
      <div className="flex items-center gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-xs text-emerald-400 font-medium">Completed</span>
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

  // Find the pending entry ONLY at the current active level
  const pendingEntry = typeof currentApprovalLevel === 'number'
    ? approvalHistory.find(a => a.level === currentApprovalLevel && a.status === 'pending')
    : approvalHistory.find(a => a.status === 'pending');

  // If current level exists in history but is NOT pending (already acted), show acted status
  const currentEntry = typeof currentApprovalLevel === 'number'
    ? approvalHistory.find(a => a.level === currentApprovalLevel)
    : null;

  // Find most recent completed (non-pending) entry for tooltip
  const lastCompletedEntry = [...approvalHistory].reverse().find(a => a.status !== 'pending');

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

  // Workflow step type label
  const aType = submission.actionType as string;
  const stepLabel = aType === 'task' ? 'Task' : aType === 'form' ? 'Form Review' : 'Approval';

  return (
    <div className="group relative flex items-center gap-2">
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

      {/* Enhancement 6: Hover tooltip showing last completed action */}
      {lastCompletedEntry && (
        <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 pointer-events-none">
          <div className="bg-navy-dark border border-navy-light/30 rounded-lg px-3 py-2 shadow-xl min-w-[200px] max-w-[280px]">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Previous Action</p>
            <p className="text-xs text-white">
              L{lastCompletedEntry.level} {lastCompletedEntry.status} by{' '}
              <span className="text-gold">{lastCompletedEntry.approverName}</span>
              {lastCompletedEntry.date && (
                <span className="text-gray-500"> on {new Date(lastCompletedEntry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              )}
            </p>
            {lastCompletedEntry.comments && (
              <p className="text-[11px] text-gray-400 mt-1 italic">"{lastCompletedEntry.comments}"</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkflowStatusBadge({ submission }: { submission: Submission }) {
  const { currentApprovalLevel, actionType, approvalHistory } = submission;

  if (currentApprovalLevel === 'completed') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400">Completed</span>;
  }
  if (currentApprovalLevel === 'rejected') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">Rejected</span>;
  }

  const level = typeof currentApprovalLevel === 'number' ? currentApprovalLevel : 1;
  const hasApproved = approvalHistory.some(h => h.status === 'approved');

  if (actionType === 'task') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gold/20 text-gold">L{level} Task Pending</span>;
  }
  if (actionType === 'form') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">Form Pending</span>;
  }

  if (hasApproved) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">L{level} Approval Pending</span>;
  }
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400">L{level} Approval Pending</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const lower = (status || '').toLowerCase();
  const styles: Record<string, string> = {
    'pending': 'bg-amber-500/20 text-amber-400',
    'in progress': 'bg-blue-500/20 text-blue-400',
    'completed': 'bg-emerald-500/20 text-emerald-400',
    'approved': 'bg-emerald-500/20 text-emerald-400',
    'rejected': 'bg-red-500/20 text-red-400',
    'denied': 'bg-red-500/20 text-red-400',
  };
  const matched = Object.entries(styles).find(([key]) => lower.includes(key));
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${matched ? matched[1] : 'bg-gray-500/20 text-gray-400'}`}>
      {status || 'Unknown'}
    </span>
  );
}

// ─── Enhancement 5: Level Progress Bar ──────────────────────────────────────
export function LevelProgress({ currentLevel, approvalHistory, levelFieldMap }: {
  currentLevel: number | 'completed' | 'rejected';
  approvalHistory: { level: number; status: string }[];
  levelFieldMap?: { level: number }[];
}) {
  // Determine total levels from levelFieldMap or approvalHistory
  const totalLevels = levelFieldMap?.length
    || Math.max(...approvalHistory.map(a => a.level), typeof currentLevel === 'number' ? currentLevel : 1);

  if (totalLevels <= 0 || totalLevels > 6) {
    return <LevelBadge level={currentLevel} />;
  }

  const activeLevel = typeof currentLevel === 'number' ? currentLevel : null;
  const isCompleted = currentLevel === 'completed';
  const isRejected = currentLevel === 'rejected';

  return (
    <div className="flex items-center gap-0" title={`${isCompleted ? 'Completed' : isRejected ? 'Rejected' : `Level ${activeLevel} of ${totalLevels}`}`}>
      {Array.from({ length: totalLevels }, (_, i) => {
        const level = i + 1;
        const entry = approvalHistory.find(a => a.level === level);
        const isApproved = entry?.status === 'approved' || (isCompleted && level <= totalLevels);
        const isActive = activeLevel === level;
        const isRej = entry?.status === 'rejected';
        const isFuture = !isApproved && !isActive && !isRej;

        // For completed submissions, all dots are green
        const dotCompleted = isCompleted;

        let dotClass = '';
        if (dotCompleted) {
          dotClass = 'bg-emerald-400';
        } else if (isRej) {
          dotClass = 'bg-red-400';
        } else if (isApproved) {
          dotClass = 'bg-emerald-400';
        } else if (isActive) {
          dotClass = 'bg-gold animate-pulse';
        } else {
          dotClass = 'bg-gray-600';
        }

        return (
          <div key={level} className="flex items-center">
            <div className={`w-2.5 h-2.5 rounded-full ${dotClass}`} title={`L${level}${isApproved ? ' ✓' : isActive ? ' (current)' : isRej ? ' ✗' : ''}`} />
            {i < totalLevels - 1 && (
              <div className={`w-3 h-0.5 ${(isApproved || dotCompleted) && !isFuture ? 'bg-emerald-400/50' : 'bg-gray-700'}`} />
            )}
          </div>
        );
      })}
      <span className="ml-1.5 text-xs text-gray-500">
        {isCompleted ? '✓' : isRejected ? '✗' : `L${activeLevel}`}
      </span>
    </div>
  );
}

export function LevelBadge({ level }: { level: number | 'completed' | 'rejected' }) {
  if (level === 'completed') return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400">Completed</span>;
  if (level === 'rejected') return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">Rejected</span>;
  const colors: Record<number, string> = {
    1: 'bg-blue-500/20 text-blue-400',
    2: 'bg-amber-500/20 text-amber-400',
    3: 'bg-purple-500/20 text-purple-400',
    4: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[level] || 'bg-gray-500/20 text-gray-400'}`}>
      L{level}
    </span>
  );
}
