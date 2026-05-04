import { useState, useMemo, useTransition, useDeferredValue, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Search, AlertCircle, CheckCircle2, Clock, Zap, ExternalLink, User, Calendar, FileText, Briefcase, Download, ArrowUpDown } from 'lucide-react';
import SubmissionModal from '../components/SubmissionModal';
import WorkflowDetailsModal from '../components/WorkflowDetailsModal';
import { Submission, WorkflowTask } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { exportToExcel } from '../services/exportService';

interface Props {
  data: ReturnType<typeof import('../hooks/useSubmissions').useSubmissions>;
}

const statusConfig = {
  pending: { color: 'from-cyan-400 to-sky-400', icon: Clock, label: 'Pending', text: 'text-white', bgLight: 'bg-cyan-400/20', iconColor: 'text-cyan-300' },
  approved: { color: 'from-blue-400 to-blue-600', icon: CheckCircle2, label: 'Approved', text: 'text-white', bgLight: 'bg-blue-500/20', iconColor: 'text-blue-300' },
  rejected: { color: 'from-indigo-500 to-indigo-600', icon: AlertCircle, label: 'Rejected', text: 'text-white', bgLight: 'bg-indigo-500/20', iconColor: 'text-indigo-300' },
  completed: { color: 'from-cyan-300 to-blue-400', icon: Zap, label: 'Completed', text: 'text-white', bgLight: 'bg-cyan-400/20', iconColor: 'text-cyan-200' },
};

// Helper to get submission status
function getSubmissionStatus(submission: Submission): keyof typeof statusConfig {
  if (submission.currentApprovalLevel === 'completed') return 'completed';
  if (submission.currentApprovalLevel === 'rejected') return 'rejected';

  const hasPending = submission.approvalHistory.some(a => a.status === 'pending');
  if (hasPending) return 'pending';

  const lastEntry = submission.approvalHistory[submission.approvalHistory.length - 1];
  if (lastEntry?.status === 'approved') return 'approved';
  if (lastEntry?.status === 'rejected') return 'rejected';

  return 'pending';
}

interface SubmissionCardProps {
  submission: Submission;
  idx: number;
  user: ReturnType<typeof import('../contexts/AuthContext').useAuth>['user'];
  onViewDetails: (submission: Submission) => void;
  onOpenModal: (submission: Submission) => void;
}

interface StatCardProps {
  label: string;
  value: number | string;
  trend: string;
  color: string;
  idx: number;
}

const StatCard = memo(function StatCard({ label, value, trend, color, idx }: StatCardProps) {
  const borderColorMap: Record<number, string> = {
    0: 'border-blue-500',
    1: 'border-cyan-400',
    2: 'border-blue-400',
    3: 'border-indigo-400',
  };
  const bgColorMap: Record<number, string> = {
    0: 'bg-blue-50',
    1: 'bg-cyan-50',
    2: 'bg-blue-50',
    3: 'bg-indigo-50',
  };
  const textColorMap: Record<number, string> = {
    0: 'text-blue-700',
    1: 'text-cyan-700',
    2: 'text-blue-700',
    3: 'text-indigo-700',
  };
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: idx * 0.1 }}
      whileHover={{ y: -6, transition: { duration: 0.2 } }}
      className={`group relative overflow-hidden rounded-2xl p-6 border-2 transition-all duration-300 cursor-pointer shadow-md hover:shadow-lg ${borderColorMap[idx % 4]}`}
      style={{
        background: '#ffffff',
      }}
    >
      <div className="relative z-10">
        <div className="flex items-start justify-between mb-4">
          <span className={`text-xs font-bold px-3 py-1.5 rounded-lg border backdrop-blur-sm ${textColorMap[idx % 4]} ${bgColorMap[idx % 4]} ${borderColorMap[idx % 4]}`}>
            {trend}
          </span>
        </div>

        <p className="text-gray-700 text-xs font-semibold uppercase tracking-wider mb-2">
          {label}
        </p>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl md:text-4xl font-black text-black">
            {value}
          </span>
        </div>
      </div>
    </motion.div>
  );
});

const SubmissionCard = memo(function SubmissionCard({ submission, idx, user, onViewDetails, onOpenModal }: SubmissionCardProps) {
  const status = getSubmissionStatus(submission);
  const statusConfig_item = statusConfig[status];
  const StatusIcon = statusConfig_item.icon;

  return (
    <motion.div
      key={submission.id}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ delay: idx * 0.05 }}
      whileHover={{ y: -8, transition: { duration: 0.3 } }}
      onClick={() => onOpenModal(submission)}
      className={`group relative overflow-hidden rounded-2xl p-6 border-2 transition-all duration-300 cursor-pointer shadow-md hover:shadow-lg ${status === 'pending' ? 'border-cyan-400 hover:border-cyan-500' : status === 'approved' ? 'border-blue-400 hover:border-blue-500' : status === 'rejected' ? 'border-indigo-500 hover:border-indigo-600' : 'border-cyan-300 hover:border-cyan-400'}`}
      style={{
        background: '#ffffff',
      }}
    >

      <div className="relative z-10 space-y-3">
        {/* Header with Title */}
        <div>
          <p className="text-xs font-bold text-gray-800 uppercase tracking-wider mb-1">
            {submission.formTitle || 'Form Submission'}
          </p>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className="text-sm font-black text-black font-mono">
                ID: {submission.id.slice(0, 8).toUpperCase()}
              </p>
            </div>
            <span className={`inline-block text-xs font-bold px-2.5 py-1 rounded-lg text-white bg-gradient-to-r ${statusConfig_item.color}`}>
              {statusConfig_item.label}
            </span>
          </div>
        </div>

        {/* Submitted By */}
        <div className="flex items-center gap-2 py-2 border-t border-gray-200">
          <User className="w-4 h-4 text-gray-700" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-800 font-medium">Submitted By</p>
            <p className="text-sm font-bold text-black truncate">
              {submission.submittedBy.name}
            </p>
            <p className="text-xs text-gray-500 truncate">
              {submission.submittedBy.email}
            </p>
          </div>
        </div>

        {/* Pending With / Current Approver */}
        <div className="flex items-center gap-2 py-2 border-t border-gray-200 bg-blue-50 px-3 rounded-lg">
          <Briefcase className="w-4 h-4 text-blue-700 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-900 font-medium">Pending With</p>
            <p className="text-sm font-bold text-black truncate">
              {submission.pendingApproverName || 'Approver'}
            </p>
            {submission.pendingApproverEmail && (
              <p className="text-xs text-gray-500 truncate">
                {submission.pendingApproverEmail}
              </p>
            )}
          </div>
        </div>

        {/* Department & Priority */}
        <div className="grid grid-cols-2 gap-2 py-2 border-t border-gray-200 text-xs">
          <div>
            <p className="text-gray-900 font-medium">Department</p>
            <p className="font-bold text-black">
              {submission.submittedBy.department || '—'}
            </p>
          </div>
          <div>
            <p className="text-gray-900 font-medium">Priority</p>
            <p className={`font-bold text-sm ${
              submission.priority === 'urgent' ? 'text-red-600' :
              submission.priority === 'high' ? 'text-orange-600' :
              submission.priority === 'medium' ? 'text-yellow-600' :
              'text-green-600'
            }`}>
              {submission.priority?.toUpperCase() || '—'}
            </p>
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-2 py-2 border-t border-gray-200 text-xs">
          <div>
            <p className="text-gray-900 font-medium">Submitted</p>
            <p className="font-bold text-black">
              {new Date(submission.submissionDate).toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-gray-900 font-medium">Pending For</p>
            <p className={`font-bold text-sm ${
              submission.daysAtCurrentLevel > 14 ? 'text-red-600' :
              submission.daysAtCurrentLevel > 7 ? 'text-orange-600' :
              'text-gray-900'
            }`}>
              {submission.daysAtCurrentLevel || 0} days
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-2 border-t border-gray-200 space-y-2">
          {/* Check if user is the pending approver */}
          {user?.email === submission.pendingApproverEmail && submission.currentApprovalLevel !== 'completed' && submission.currentApprovalLevel !== 'rejected' ? (
            <motion.button
              whileHover={{ scale: 1.02 }}
              onClick={() => onViewDetails(submission)}
              className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-gradient-to-r ${statusConfig_item.color} text-white font-semibold text-sm transition-all hover:shadow-lg border border-transparent`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Review & Approve</span>
            </motion.button>
          ) : submission.actionType === 'form' && submission.formUrl ? (
            <a
              href={submission.formUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-gradient-to-r ${statusConfig_item.color} text-white font-semibold text-sm transition-all hover:shadow-lg border border-transparent`}
            >
              <FileText className="w-4 h-4" />
              <span>Fill Form</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          ) : submission.approvalUrl ? (
            <a
              href={submission.approvalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-gradient-to-r ${statusConfig_item.color} text-white font-semibold text-sm transition-all hover:shadow-lg border border-transparent`}
            >
              <ExternalLink className="w-4 h-4" />
              <span>View Task</span>
            </a>
          ) : (
            <motion.button
              whileHover={{ x: 4 }}
              onClick={() => onViewDetails(submission)}
              className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-gradient-to-r ${statusConfig_item.color} text-white font-semibold text-sm transition-all hover:shadow-lg border border-transparent group/btn`}
            >
              <span>View Details</span>
              <span className="group-hover/btn:translate-x-1 transition-transform">→</span>
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  );
});

export default function ModernDashboard({ data }: Props) {
  const { allSubmissions, loading } = data;
  const { user } = useAuth();

  // Fiber optimizations
  const [isPending, startTransition] = useTransition();

  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [workflowModalSubmission, setWorkflowModalSubmission] = useState<Submission | null>(null);
  const [expandedTasks, setExpandedTasks] = useState<WorkflowTask[]>([]);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'latest' | 'oldest' | 'days'>('latest');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Defer expensive search rendering
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Filter and sort submissions
  const filteredAndSortedSubmissions = useMemo(() => {
    let filtered = allSubmissions
      // Filter to show only PRIMARY forms - exclude child "Workflow Form" submissions
      .filter(sub => !sub.formTitle.includes('Workflow Form'))
      .filter(sub => {
        const matchesSearch = sub.id.toLowerCase().includes(deferredSearchQuery.toLowerCase()) ||
          sub.submittedBy.name.toLowerCase().includes(deferredSearchQuery.toLowerCase()) ||
          sub.formTitle.toLowerCase().includes(deferredSearchQuery.toLowerCase());
        const status = getSubmissionStatus(sub);
        const matchesStatus = filterStatus === 'all' || status === filterStatus;
        return matchesSearch && matchesStatus;
      });

    // Sort based on selection
    if (sortBy === 'latest') {
      filtered.sort((a, b) => new Date(b.submissionDate).getTime() - new Date(a.submissionDate).getTime());
    } else if (sortBy === 'oldest') {
      filtered.sort((a, b) => new Date(a.submissionDate).getTime() - new Date(b.submissionDate).getTime());
    } else if (sortBy === 'days') {
      filtered.sort((a, b) => b.daysAtCurrentLevel - a.daysAtCurrentLevel);
    }

    return filtered;
  }, [allSubmissions, deferredSearchQuery, filterStatus, sortBy]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedSubmissions.length / itemsPerPage);
  const paginatedSubmissions = filteredAndSortedSubmissions.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Memoized callbacks
  const handleExport = useCallback(() => {
    exportToExcel(filteredAndSortedSubmissions, 'Modern Dashboard Data');
  }, [filteredAndSortedSubmissions]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    startTransition(() => {
      setSearchQuery(e.target.value);
      setCurrentPage(1);
    });
  }, []);

  const handleStatusFilter = useCallback((status: string) => {
    startTransition(() => {
      setFilterStatus(status);
      setCurrentPage(1);
    });
  }, []);

  const handleSortChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    startTransition(() => {
      setSortBy(e.target.value as 'latest' | 'oldest' | 'days');
      setCurrentPage(1);
    });
  }, []);

  const handleViewDetails = useCallback((submission: Submission) => {
    setSelectedSubmission(submission);
  }, []);

  const handleOpenWorkflow = useCallback(async (submission: Submission) => {
    setWorkflowModalSubmission(submission);
    setWorkflowLoading(true);
    try {
      const res = await fetch(`/api/workflow-tasks?submissionId=${submission.id}`);
      if (res.ok) {
        const json = await res.json();
        setExpandedTasks(json.tasks || []);
      } else {
        setExpandedTasks([]);
      }
    } catch {
      setExpandedTasks([]);
    } finally {
      setWorkflowLoading(false);
    }
  }, []);

  // Stats cards with dynamic calculations
  const pendingCount = allSubmissions.filter(s => getSubmissionStatus(s) === 'pending').length;
  const approvedCount = allSubmissions.filter(s => getSubmissionStatus(s) === 'approved').length;
  const completedCount = allSubmissions.filter(s => getSubmissionStatus(s) === 'completed').length;
  const rejectedCount = allSubmissions.filter(s => getSubmissionStatus(s) === 'rejected').length;
  const criticalCount = allSubmissions.filter(s => s.daysAtCurrentLevel > 7).length;
  const avgDays = allSubmissions.length > 0
    ? Math.round(allSubmissions.reduce((sum, s) => sum + (s.daysAtCurrentLevel || 0), 0) / allSubmissions.length)
    : 0;

  // Dynamic trend calculations
  const totalSubmissionsChange = allSubmissions.length > 0 ? '+' + allSubmissions.length : '0';
  const pendingTrendChange = criticalCount > 0 ? `${criticalCount} critical` : 'On track';
  const approvedTrendChange = completedCount + approvedCount;
  const avgDaysChange = avgDays > 0 ? avgDays + 'd' : '—';

  const stats = [
    {
      label: 'Total Submissions',
      value: allSubmissions.length,
      color: 'from-blue-500 to-blue-600',
      trend: totalSubmissionsChange,
    },
    {
      label: 'Pending Review',
      value: pendingCount,
      color: 'from-cyan-400 to-sky-500',
      trend: pendingTrendChange,
    },
    {
      label: 'Approved',
      value: approvedCount,
      color: 'from-blue-400 to-blue-600',
      trend: approvedTrendChange > 0 ? '+' + approvedTrendChange : '0',
    },
    {
      label: 'Avg Processing',
      value: `${avgDays}d`,
      color: 'from-indigo-400 to-blue-500',
      trend: avgDaysChange,
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <motion.div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto" />
          <p className="text-gray-400 text-sm">Loading modern dashboard...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-8 w-full px-4">
      {/* Header Section */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-2"
      >
        <h1 className="text-3xl md:text-4xl font-black text-black">
          Workflow Dashboard
        </h1>
        <p className="text-gray-600 text-sm md:text-base">Smart submission tracking & approval management</p>
      </motion.div>

      {/* Stats Grid */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ staggerChildren: 0.1 }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {stats.map((stat, idx) => (
          <StatCard
            key={idx}
            idx={idx}
            label={stat.label}
            value={stat.value}
            trend={stat.trend}
            color={stat.color}
          />
        ))}
      </motion.div>

      {/* Search, Filter & Action Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="space-y-4"
      >
        {/* Search Bar */}
        <div className="flex-1 relative w-full">
          <Search className="absolute left-4 top-3.5 w-5 h-5 text-gray-500" />
          <input
            type="text"
            placeholder="Search by ID, name, or form title..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="w-full pl-12 pr-4 py-3 rounded-xl bg-white border border-gray-300 text-black placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-200"
          />
        </div>

        {/* Controls Row */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          {/* Status Filter */}
          <div className="flex gap-2 flex-wrap">
            {['all', 'pending', 'approved', 'rejected', 'completed'].map(status => {
              const filterColors: Record<string, string> = {
                all: 'from-blue-500 to-blue-600',
                pending: 'from-cyan-400 to-sky-400',
                approved: 'from-blue-400 to-blue-600',
                rejected: 'from-indigo-500 to-indigo-600',
                completed: 'from-cyan-300 to-blue-400',
              };
              return (
                <motion.button
                  key={status}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleStatusFilter(status)}
                  className={`px-3 py-2 rounded-lg font-semibold text-sm transition-all duration-200 border ${
                    filterStatus === status
                      ? `bg-gradient-to-r ${filterColors[status]} text-white shadow-lg border-transparent`
                      : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </motion.button>
              );
            })}
          </div>

          {/* Sort & Export */}
          <div className="flex gap-2 items-center">
            {/* Sort Dropdown */}
            <div className="relative">
              <select
                value={sortBy}
                onChange={handleSortChange}
                className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 font-semibold text-sm focus:outline-none focus:border-blue-500 appearance-none pr-8 cursor-pointer"
              >
                <option value="latest">Latest First</option>
                <option value="oldest">Oldest First</option>
                <option value="days">Days Pending</option>
              </select>
              <ArrowUpDown className="w-4 h-4 absolute right-2 top-2.5 text-gray-600 pointer-events-none" />
            </div>

            {/* Export Button */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleExport}
              disabled={filteredAndSortedSubmissions.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold text-sm transition-all hover:shadow-lg border border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              Export
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* Cards Grid */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ staggerChildren: 0.05 }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
      >
        <AnimatePresence>
          {paginatedSubmissions.length > 0 ? (
            paginatedSubmissions.map((submission, idx) => (
              <SubmissionCard
                key={submission.id}
                submission={submission}
                idx={idx}
                user={user}
                onViewDetails={handleViewDetails}
                onOpenModal={handleOpenWorkflow}
              />
            ))
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="col-span-full flex flex-col items-center justify-center py-16"
            >
              <AlertCircle className="w-12 h-12 text-gray-500 mb-4" />
              <p className="text-gray-600 text-sm">No submissions found</p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Pagination */}
      {totalPages > 1 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mt-8 px-4 py-4 bg-white rounded-xl border border-gray-200 shadow-sm"
        >
          <p className="text-sm font-semibold text-gray-700">
            Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredAndSortedSubmissions.length)} of {filteredAndSortedSubmissions.length} submissions
          </p>
          <div className="flex gap-2">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Previous
            </motion.button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(page => Math.abs(page - currentPage) <= 1 || page === 1 || page === totalPages)
              .map((page, idx, arr) => (
                <div key={page}>
                  {idx > 0 && arr[idx - 1] !== page - 1 && <span className="px-2 text-gray-600">...</span>}
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setCurrentPage(page)}
                    className={`px-3 py-2 rounded-lg font-semibold transition-all ${
                      currentPage === page
                        ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
                        : 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
                    }`}
                  >
                    {page}
                  </motion.button>
                </div>
              ))}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Next
            </motion.button>
          </div>
        </motion.div>
      )}

      {/* Submission Modal */}
      <AnimatePresence>
        {selectedSubmission && (
          <SubmissionModal
            submission={selectedSubmission}
            onClose={() => setSelectedSubmission(null)}
          />
        )}
      </AnimatePresence>

      {/* Workflow Details Modal */}
      <AnimatePresence>
        {workflowModalSubmission && (
          <WorkflowDetailsModal
            submission={workflowModalSubmission}
            expandedTasks={expandedTasks}
            expandLoading={workflowLoading ? workflowModalSubmission.id : undefined}
            onClose={() => setWorkflowModalSubmission(null)}
            user={user}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
