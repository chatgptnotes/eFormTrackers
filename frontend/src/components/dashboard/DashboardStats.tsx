import { memo } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

interface Props {
  totalCount: number;
  pendingCount: number;
  completedCount: number;
  rejectedCount: number;
  criticalCount: number;
  syncNeededCount: number;
  /** Adds animation on initial mount (rare). */
  approvedToday: number;
}

/**
 * 5-card stats row for the Director Dashboard.
 * Pure presentational — all counters computed in the parent.
 */
function DashboardStatsImpl({
  totalCount,
  pendingCount,
  completedCount,
  rejectedCount,
  criticalCount,
  syncNeededCount,
  approvedToday,
}: Props) {
  const stats = [
    { label: 'Total Requests', value: totalCount, icon: TrendingUp, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
    { label: syncNeededCount > 0 ? `Pending (${syncNeededCount} sync)` : 'Pending Approval', value: pendingCount, icon: FileText, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Completed', value: completedCount + approvedToday, icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', link: '/app/completed' },
    { label: 'Rejected', value: rejectedCount, icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
    { label: 'Critical (>7d)', value: criticalCount, icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  ] as const;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          onClick={() => { if ('link' in stat && stat.link) window.location.href = stat.link; }}
          className={`glass-card p-4 ${'link' in stat && stat.link ? 'cursor-pointer hover:border-emerald-400/50 transition-colors' : ''}`}
        >
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${stat.bg}`}>
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stat.value}</p>
              <p className="text-xs text-gray-500">{stat.label}</p>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

export const DashboardStats = memo(DashboardStatsImpl);
