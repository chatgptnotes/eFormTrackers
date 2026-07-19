import { useState, useMemo, useCallback, useEffect, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Search, User, ChevronLeft, ChevronRight, Hourglass } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { getMyWorkflowRole, isSubmissionVisible } from '../config/currentUser';
import { Submission, WorkflowTask } from '../types';
import { SkeletonSubmissionCard } from '../components/Skeleton';
import WorkflowDetailsSidebar from '../components/WorkflowDetailsSidebar';
import SubmissionModal from '../components/SubmissionModal';
import { apiFetch } from '../lib/api';
import { getUsableTaskAccessLink } from '../lib/jotformLinks';
import WorkflowPicker from '../components/WorkflowPicker';
import TeamProfilePicker from '../components/TeamProfilePicker';

interface Props {
  data: ReturnType<typeof import('../hooks/useSubmissions').useSubmissions>;
}

function formatDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface CardProps {
  submission: Submission;
  idx: number;
  onClick: (sub: Submission) => void;
  userEmail?: string | null;
}

const PendingWithCard = memo(function PendingWithCard({ submission, idx, onClick, userEmail }: CardProps) {
  const myRole = getMyWorkflowRole(submission, userEmail);
  const pendingWith = submission.pendingApproverName || submission.pendingApproverEmail || 'Unknown';
  const level = submission.currentApprovalLevel;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ delay: idx * 0.05 }}
      whileHover={{ y: -8, transition: { duration: 0.3 } }}
      onClick={() => onClick(submission)}
      className="group relative overflow-hidden rounded-2xl p-6 border-2 border-amber-400 hover:border-amber-500 bg-white transition-all duration-300 cursor-pointer shadow-md hover:shadow-lg"
    >
      <div className="relative z-10 space-y-3">
        <div>
          <p className="text-xs font-bold text-gray-800 uppercase tracking-wider mb-1">
            {submission.formTitle || 'Form Submission'}
          </p>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-black text-black font-mono">ID: {submission.id.slice(0, 8).toUpperCase()}</p>
            <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-lg text-white bg-gradient-to-r from-amber-400 to-orange-500">
              {typeof level === 'number' ? `Level ${level}` : 'In Progress'}
            </span>
          </div>
          {myRole ? <span className="inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">You: {myRole}</span> : null}
        </div>
        <div className="flex items-center gap-2 py-2 border-t border-gray-200 bg-amber-50 px-3 rounded-lg">
          <Hourglass className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-900 font-medium">Pending With</p>
            <p className="text-sm font-bold text-black truncate">{pendingWith}</p>
            {submission.pendingApproverEmail && submission.pendingApproverName && (
              <p className="text-xs text-gray-500 truncate">{submission.pendingApproverEmail}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 py-2 border-t border-gray-200">
          <User className="w-4 h-4 text-gray-700" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-800 font-medium">Submitted By</p>
            <p className="text-sm font-bold text-black truncate">{submission.submittedBy.name}</p>
            <p className="text-xs text-gray-500 truncate">{submission.submittedBy.email}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 py-2 border-t border-gray-200 text-xs">
          <div><p className="text-gray-900 font-medium">Department</p><p className="font-bold text-black">{submission.submittedBy.department || '—'}</p></div>
          <div><p className="text-gray-900 font-medium">Days at Level</p><p className="font-bold text-black">{submission.daysAtCurrentLevel ?? 0}d</p></div>
        </div>
        <div className="grid grid-cols-2 gap-2 py-2 border-t border-gray-200 text-xs">
          <div><p className="text-gray-900 font-medium">Submitted</p><p className="font-bold text-black">{formatDate(submission.submissionDate)}</p></div>
          <div><p className="text-gray-900 font-medium">Total Days</p><p className="font-bold text-black">{submission.totalDaysSinceSubmission ?? submission.daysAtCurrentLevel ?? 0}d</p></div>
        </div>
        <div className="pt-2 border-t border-gray-200">
          <motion.button
            whileHover={{ x: 4 }}
            onClick={(e) => { e.stopPropagation(); onClick(submission); }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 text-white font-semibold text-sm transition-all hover:shadow-lg"
          >
            <span>View Details</span>
            <span className="group-hover:translate-x-1 transition-transform">→</span>
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
});

export default function PendingWithPage({ data }: Props) {
  const { user, orgRole } = useAuth();
  const { activeWorkflowId, setActiveWorkflowId } = useApp();

  const [search, setSearch] = useState('');
  const [sidebarSubmission, setSidebarSubmission] = useState<Submission | null>(null);
  const [expandedTasks, setExpandedTasks] = useState<WorkflowTask[]>([]);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowCache, setWorkflowCache] = useState<Map<string, WorkflowTask[]>>(new Map());
  const ITEMS_PER_PAGE = 9;
  const [currentPage, setCurrentPage] = useState(1);
  // Approve/Reject in the sidebar opens the full approve-&-sign modal (signature
  // capture + comment), same as the dashboards. Without this the sidebar buttons
  // were no-ops (their handler props weren't wired).
  const [modalSubmission, setModalSubmission] = useState<Submission | null>(null);

  const openApproveModal = useCallback(() => {
    if (sidebarSubmission) setModalSubmission(sidebarSubmission);
  }, [sidebarSubmission]);

  // Open tasks that have a real task form, or assigned forms with a prefill URL.
  const openTaskLink = useCallback(async (task: WorkflowTask) => {
    const sub = sidebarSubmission;
    if (task.type === 'workflow_assign_task') {
      if (sub) setModalSubmission(sub);
      return;
    }
    let url = '';
    let reason = '';
    if (sub) {
      try {
        const taskParam = task.taskId ? `&taskId=${encodeURIComponent(task.taskId)}` : '';
        const json = await apiFetch<{ approvalUrl?: string | null; reason?: string; error?: string }>(
          `/api/email-url?formId=${encodeURIComponent(sub.formId)}&submissionId=${encodeURIComponent(sub.id)}${taskParam}`,
          { throwOnError: false },
        );
        if (json?.approvalUrl) url = json.approvalUrl;
        else reason = json?.reason || json?.error || 'no url returned';
      } catch (e) {
        reason = (e as Error)?.message || String(e);
      }
    }
    if (!url) url = getUsableTaskAccessLink(task);

    if (!url) {
      // eslint-disable-next-line no-console
      console.warn('[openTaskLink] no URL resolved:', { reason, taskId: task.taskId, type: task.type });
      alert(`Couldn't open the JotForm task: ${reason || 'this step has no accessible link'}`);
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }, [sidebarSubmission]);

  // Workflows still in flight that involve the logged-in email. This page is a
  // personal queue: admins do not get an all-workflows bypass here.
  const basePendingWithSubmissions = useMemo(() => {
    return data.allSubmissions.filter(s =>
      s.currentApprovalLevel !== 'completed' &&
      s.currentApprovalLevel !== 'rejected' &&
      isSubmissionVisible(s, user?.email, orgRole)
    );
  }, [data.allSubmissions, user?.email, orgRole]);

  const workflowOptions = useMemo(() => {
    const byId = new Map<string, string>();
    basePendingWithSubmissions.forEach(s => byId.set(s.formId, s.formTitle || s.formId));
    return [...byId].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title));
  }, [basePendingWithSubmissions]);

  const pendingWithSubmissions = useMemo(
    () => basePendingWithSubmissions.filter(s => !activeWorkflowId || s.formId === activeWorkflowId),
    [basePendingWithSubmissions, activeWorkflowId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pendingWithSubmissions;
    return pendingWithSubmissions.filter(s =>
      s.formTitle?.toLowerCase().includes(q) ||
      s.id?.toLowerCase().includes(q) ||
      s.submittedBy.name?.toLowerCase().includes(q) ||
      s.pendingApproverName?.toLowerCase().includes(q) ||
      s.pendingApproverEmail?.toLowerCase().includes(q)
    );
  }, [pendingWithSubmissions, search]);

  useEffect(() => { setCurrentPage(1); }, [search, activeWorkflowId]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = useMemo(
    () => filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE),
    [filtered, currentPage]
  );

  const openSidebarWithTasks = useCallback(async (sub: Submission) => {
    setSidebarSubmission(sub);
    if (workflowCache.has(sub.id)) {
      setExpandedTasks(workflowCache.get(sub.id) || []);
      return;
    }
    // DB-first: use the workflow_tasks column already on the submission row.
    if (sub.workflowTasks && sub.workflowTasks.length > 0) {
      setExpandedTasks(sub.workflowTasks);
      setWorkflowCache(prev => new Map(prev).set(sub.id, sub.workflowTasks!));
      return;
    }
    setWorkflowLoading(true);
    try {
      const url = `/api/workflow-tasks?submissionId=${sub.id}${sub.workflowInstanceId ? `&workflowInstanceId=${sub.workflowInstanceId}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) { setWorkflowLoading(false); return; }
      const json = await res.json();
      const tasks = json.tasks || [];
      setExpandedTasks(tasks);
      setWorkflowCache(prev => new Map(prev).set(sub.id, tasks));
    } catch {
      setExpandedTasks([]);
    } finally {
      setWorkflowLoading(false);
    }
  }, [workflowCache]);

  if (data.loading && data.allSubmissions.length === 0) {
    return (
      <div className="app-page w-full px-4 py-6">
        <div className="responsive-card-grid">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonSubmissionCard key={i} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="app-page relative">
      <div className={`space-y-6 w-full px-4 py-2 transition-all duration-300 ${sidebarSubmission ? '2xl:pr-[500px]' : ''}`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 text-gray-600">
            <Clock className="w-5 h-5 text-amber-500" />
            <span className="text-sm font-semibold">{filtered.length} workflow{filtered.length === 1 ? '' : 's'} pending</span>
          </div>
          <TeamProfilePicker />
          <WorkflowPicker
            value={activeWorkflowId}
            options={workflowOptions}
            onChange={id => { setActiveWorkflowId(id); setCurrentPage(1); }}
            accent="amber"
          />
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search ID, title, or person"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-gray-300 text-black placeholder-gray-500 text-sm focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
            <Hourglass className="w-10 h-10 text-amber-400 mb-3" />
            <p className="text-gray-700 font-semibold">Nothing pending right now</p>
            <p className="text-gray-500 text-sm mt-1 max-w-md">
              Workflows you've submitted, acted on, or are assigned to will appear here while they're still in progress.
            </p>
          </div>
        ) : (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="responsive-card-grid">
              <AnimatePresence>
                {paginated.map((sub, idx) => (
                  <PendingWithCard key={sub.id} submission={sub} idx={idx} onClick={openSidebarWithTasks} userEmail={user?.email} />
                ))}
              </AnimatePresence>
            </motion.div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-amber-400"
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </button>
                <span className="text-sm text-gray-600">Page {currentPage} of {totalPages}</span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-amber-400"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <WorkflowDetailsSidebar
        isOpen={!!sidebarSubmission}
        submission={sidebarSubmission}
        expandedTasks={expandedTasks}
        expandLoading={workflowLoading ? sidebarSubmission?.id : undefined}
        user={user}
        showOverlay={false}
        isAbsolute={true}
        onClose={() => setSidebarSubmission(null)}
        onTaskApprove={openApproveModal}
        onSetTaskRejecting={openApproveModal}
        onOpenTaskLink={openTaskLink}
      />

      <AnimatePresence>
        {modalSubmission && (
          <SubmissionModal
            submission={modalSubmission}
            onClose={() => setModalSubmission(null)}
            onUpdate={() => {
              setModalSubmission(null);
              setSidebarSubmission(null);
              data.refresh?.({ force: true });
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
