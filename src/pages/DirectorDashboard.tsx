import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, XCircle, AlertTriangle, User,
  Search, ArrowUpDown, ChevronDown, ChevronUp, FileText,
  TrendingUp, Shield,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { useSubmissions } from '../hooks/useSubmissions';
import { Submission } from '../types';
import SubmissionModal from '../components/SubmissionModal';
import { useDashboardActions } from '../hooks/useDashboardActions';
import SubmissionTableRow from '../components/dashboard/SubmissionTableRow';
import SyncConfirmModal from '../components/dashboard/SyncConfirmModal';

interface Props {
  data: ReturnType<typeof useSubmissions>;
}

type ChipKey = 'urgent' | 'high' | 'critical7d' | 'myLevel';

export default function DirectorDashboard({ data }: Props) {
  const { activeSidebarCategory, activeWorkflowId } = useApp();
  const actions = useDashboardActions(data);
  const { currentUser } = actions;

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'daysAtCurrentLevel' | 'submissionDate' | 'currentApprovalLevel'>('submissionDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [commentingId, setCommentingId] = useState<string | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [activeChips, setActiveChips] = useState<Set<ChipKey>>(new Set());

  const openModal = (sub: Submission) => {
    actions.setRejectingId(null);
    actions.setConfirmRejectId(null);
    actions.setRejectReason('');
    setSelectedSubmission(sub);
  };

  const toggleChip = (chip: ChipKey) => {
    setActiveChips(prev => {
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      return next;
    });
  };

  const dismissedIds = useMemo(() => new Set([...actions.approvedIds, ...actions.rejectedIds]), [actions.approvedIds, actions.rejectedIds]);

  // Base filtered submissions (before chip filters)
  const baseSubmissions = useMemo(() => {
    let subs = data.allSubmissions.filter(s => {
      if (dismissedIds.has(s.id)) return false;
      if (currentUser.isAdmin) return true;
      if (typeof s.currentApprovalLevel !== 'number') return true;
      const atDirectorLevel = currentUser.approvalLevels.includes(s.currentApprovalLevel as number);
      const pendingEntry = s.approvalHistory?.find(a => a.status === 'pending');
      const nameMatch = pendingEntry?.approverName && currentUser.nameMatches.length > 0
        ? currentUser.nameMatches.some(m => pendingEntry.approverName.toLowerCase().includes(m))
        : false;
      return atDirectorLevel || nameMatch;
    });

    if (activeWorkflowId) {
      subs = subs.filter(s => s.formId === activeWorkflowId);
    }
    if (activeSidebarCategory?.filter?.departments?.length) {
      subs = subs.filter(s => activeSidebarCategory.filter!.departments!.includes(s.submittedBy.department));
    }
    if (activeSidebarCategory?.filter?.formIds?.length) {
      subs = subs.filter(s => activeSidebarCategory.filter!.formIds!.includes(s.formId));
    }
    if (search) {
      const q = search.toLowerCase();
      subs = subs.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.referenceNumber.toLowerCase().includes(q) ||
        s.submittedBy.name.toLowerCase().includes(q) ||
        s.formTitle.toLowerCase().includes(q)
      );
    }
    return subs;
  }, [data.allSubmissions, activeSidebarCategory, activeWorkflowId, search, dismissedIds, currentUser]);

  // Chip counts (computed from base submissions)
  const chipCounts = useMemo(() => ({
    urgent: baseSubmissions.filter(s => s.priority === 'urgent').length,
    high: baseSubmissions.filter(s => s.priority === 'high').length,
    critical7d: baseSubmissions.filter(s => s.daysAtCurrentLevel > 7 && typeof s.currentApprovalLevel === 'number').length,
    myLevel: baseSubmissions.filter(s => typeof s.currentApprovalLevel === 'number' && currentUser.approvalLevels.includes(s.currentApprovalLevel)).length,
  }), [baseSubmissions, currentUser]);

  // Apply chip filters + sorting
  const directorSubmissions = useMemo(() => {
    let subs = [...baseSubmissions];

    if (activeChips.size > 0) {
      subs = subs.filter(s => {
        if (activeChips.has('urgent') && s.priority === 'urgent') return true;
        if (activeChips.has('high') && s.priority === 'high') return true;
        if (activeChips.has('critical7d') && s.daysAtCurrentLevel > 7 && typeof s.currentApprovalLevel === 'number') return true;
        if (activeChips.has('myLevel') && typeof s.currentApprovalLevel === 'number' && currentUser.approvalLevels.includes(s.currentApprovalLevel)) return true;
        return false;
      });
    }

    subs.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'daysAtCurrentLevel') cmp = a.daysAtCurrentLevel - b.daysAtCurrentLevel;
      else if (sortKey === 'submissionDate') cmp = a.submissionDate.localeCompare(b.submissionDate);
      else if (sortKey === 'currentApprovalLevel') cmp = Number(a.currentApprovalLevel) - Number(b.currentApprovalLevel);
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return subs;
  }, [baseSubmissions, activeChips, sortKey, sortDir, currentUser]);

  // Stats
  const pendingCount = directorSubmissions.filter(s => typeof s.currentApprovalLevel === 'number').length;
  const completedCount = directorSubmissions.filter(s => s.currentApprovalLevel === 'completed').length;
  const rejectedCount = directorSubmissions.filter(s => s.currentApprovalLevel === 'rejected').length;
  const criticalCount = directorSubmissions.filter(s => s.daysAtCurrentLevel > 7 && typeof s.currentApprovalLevel === 'number').length;
  const approvedToday = actions.approvedIds.size;

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: typeof sortKey }) => (
    sortKey === field
      ? (sortDir === 'desc' ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />)
      : <ArrowUpDown className="w-3.5 h-3.5 opacity-30" />
  );

  // Skeleton: only shown on very first load when Supabase cache is also empty
  if (data.loading && data.allSubmissions.length === 0) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="glass-card p-5 border border-gold/20">
          <div className="h-7 bg-navy-light/30 rounded w-64 mb-2" />
          <div className="h-4 bg-navy-light/20 rounded w-48" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-card p-4">
              <div className="h-8 bg-navy-light/30 rounded w-12 mb-1" />
              <div className="h-3 bg-navy-light/20 rounded w-24" />
            </div>
          ))}
        </div>
        <div className="glass-card overflow-hidden">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="border-b border-navy-light/10 px-4 py-4 flex items-center gap-4">
              <div className="h-4 bg-navy-light/30 rounded w-14" />
              <div className="h-4 bg-navy-light/20 rounded w-52" />
              <div className="h-4 bg-navy-light/20 rounded w-32 ml-4" />
              <div className="h-4 bg-navy-light/20 rounded w-10 ml-auto" />
              <div className="h-6 bg-navy-light/30 rounded w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Error/Warning Banner */}
      {data.error && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span>{data.error}</span>
        </div>
      )}

      {/* Welcome Banner */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-5 border border-gold/20 bg-gradient-to-r from-gold/5 to-transparent"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">
              Welcome, {currentUser.name} — <span className="text-gold capitalize">{currentUser.role}</span>
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {directorSubmissions.length > 0
                ? `${directorSubmissions.length} submission${directorSubmissions.length !== 1 ? 's' : ''} — ${pendingCount} pending, ${completedCount} completed, ${rejectedCount} rejected`
                : 'No submissions found'}
            </p>
            {activeWorkflowId && (
              <p className="text-xs text-gold/70 mt-0.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-gold/70 inline-block" />
                Workflow: {data.allSubmissions.find(s => s.formId === activeWorkflowId)?.formTitle ?? activeWorkflowId}
              </p>
            )}
            {!activeWorkflowId && activeSidebarCategory?.label && activeSidebarCategory.id !== 'all' && (
              <p className="text-xs text-gray-500 mt-0.5">Filter: {activeSidebarCategory.label}</p>
            )}
          </div>
          <div className="w-12 h-12 rounded-full bg-gold/20 flex items-center justify-center">
            <User className="w-6 h-6 text-gold" />
          </div>
        </div>
      </motion.div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Pending Approval', value: pendingCount, icon: FileText, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Completed', value: completedCount + approvedToday, icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Rejected', value: rejectedCount, icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
          { label: 'Critical (>7d)', value: criticalCount, icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card p-4"
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

      {/* Search */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by reference, title, submitter, or form type..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-navy-dark border border-navy-light/30 text-sm text-white placeholder-gray-600 focus:border-gold/50 focus:outline-none"
          />
        </div>
      </motion.div>

      {/* Enhancement 4: Quick Filter Chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { key: 'urgent' as ChipKey, label: 'Urgent', color: 'bg-red-500/20 text-red-400 border-red-500/30', activeColor: 'bg-red-500/40 text-red-300 border-red-500/50' },
          { key: 'high' as ChipKey, label: 'High Priority', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30', activeColor: 'bg-orange-500/40 text-orange-300 border-orange-500/50' },
          { key: 'critical7d' as ChipKey, label: 'Critical >7d', color: 'bg-red-500/20 text-red-400 border-red-500/30', activeColor: 'bg-red-500/40 text-red-300 border-red-500/50 animate-pulse' },
          { key: 'myLevel' as ChipKey, label: 'My Level', color: 'bg-gold/20 text-gold border-gold/30', activeColor: 'bg-gold/40 text-gold border-gold/50' },
        ]).map(chip => {
          const count = chipCounts[chip.key];
          const isActive = activeChips.has(chip.key);
          return (
            <button
              key={chip.key}
              onClick={() => toggleChip(chip.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${isActive ? chip.activeColor : chip.color} hover:scale-105`}
            >
              {chip.label}
              {count > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-white/10 text-[10px]">{count}</span>
              )}
            </button>
          );
        })}
        {activeChips.size > 0 && (
          <button
            onClick={() => setActiveChips(new Set())}
            className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="glass-card overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-navy-light/20">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ref#</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title / Form</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Submitted By</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer select-none" onClick={() => toggleSort('currentApprovalLevel')}>
                  <div className="flex items-center gap-1">Level <SortIcon field="currentApprovalLevel" /></div>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pending With</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer select-none" onClick={() => toggleSort('daysAtCurrentLevel')}>
                  <div className="flex items-center gap-1">Aging <SortIcon field="daysAtCurrentLevel" /></div>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {directorSubmissions.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Shield className="w-10 h-10 text-emerald-400/50" />
                        <p className="text-gray-400">No submissions found</p>
                        <p className="text-xs text-gray-600">Try clearing your search or filters</p>
                      </div>
                    </td>
                  </tr>
                )}
                {directorSubmissions.map((sub) => (
                  <SubmissionTableRow
                    key={sub.id}
                    sub={sub}
                    currentUser={currentUser}
                    commentingId={commentingId}
                    setCommentingId={setCommentingId}
                    rejectingId={actions.rejectingId}
                    setRejectingId={actions.setRejectingId}
                    rejectReason={actions.rejectReason}
                    setRejectReason={actions.setRejectReason}
                    confirmRejectId={actions.confirmRejectId}
                    setConfirmRejectId={actions.setConfirmRejectId}
                    actionLoading={actions.actionLoading}
                    taskUrlLoading={actions.taskUrlLoading}
                    formUrlLoading={actions.formUrlLoading}
                    onOpenModal={openModal}
                    onReject={actions.handleReject}
                    onOpenTaskUrl={actions.openTaskUrl}
                    onOpenFormUrl={actions.openFormUrl}
                    onSyncClick={actions.setSyncSubmission}
                  />
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-navy-light/20 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Showing {directorSubmissions.length} pending approval{directorSubmissions.length !== 1 ? 's' : ''}
          </p>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <TrendingUp className="w-3.5 h-3.5" />
            Sort: {sortKey === 'daysAtCurrentLevel' ? 'Aging' : sortKey === 'submissionDate' ? 'Date' : 'Level'} ({sortDir})
          </div>
        </div>
      </motion.div>

      {/* Submission Detail Modal */}
      {selectedSubmission && (
        <SubmissionModal
          submission={selectedSubmission}
          onClose={() => setSelectedSubmission(null)}
          onUpdate={(updatedId, newLevel, newStatus) => {
            setSelectedSubmission(null);
            if (updatedId) {
              data.optimisticUpdate(updatedId, { newLevel, newJotformStatus: newStatus, approverName: currentUser.name });
            }
            setTimeout(() => data.refresh({ force: true }), 3000);
          }}
        />
      )}

      {/* Sync Confirmation Modal */}
      <AnimatePresence>
        {actions.syncSubmission && (
          <SyncConfirmModal
            submission={actions.syncSubmission}
            loading={actions.syncLoading}
            onConfirm={actions.handleSyncConfirm}
            onClose={() => actions.setSyncSubmission(null)}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
