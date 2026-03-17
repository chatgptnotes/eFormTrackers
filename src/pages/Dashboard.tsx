import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, Clock, AlertTriangle, User, Building2, Calendar, Loader2, ChevronRight, Mail, Shield } from 'lucide-react';
import SubmissionModal from '../components/SubmissionModal';
import { Submission } from '../types';

// ── Director context (hardcoded for demo) ───────────────────────────────────
const DIRECTOR = {
  name: 'Huzaifa Dawasaz',
  email: 'huzaifa.dawasaz@mediaoffice.ae',
  title: 'Director',
  approvalLevel: 3,
};

interface Props {
  data: ReturnType<typeof import('../hooks/useSubmissions').useSubmissions>;
}

export default function Dashboard({ data }: Props) {
  const { allSubmissions, loading, refresh } = data;

  // Only show submissions pending at the director's approval level
  const pendingSubmissions = allSubmissions.filter(
    s => s.currentApprovalLevel === DIRECTOR.approvalLevel
  ).sort((a, b) => b.daysAtCurrentLevel - a.daysAtCurrentLevel);

  const [decisions, setDecisions] = useState<Record<string, 'approved' | 'rejected'>>({});
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 text-gold animate-spin mx-auto" />
          <p className="text-gray-400 text-sm">Loading your approval queue...</p>
        </div>
      </div>
    );
  }

  const pending = pendingSubmissions.filter(s => !decisions[s.id]);
  const critical = pending.filter(s => s.daysAtCurrentLevel > 7);
  const avgDays = pending.length > 0
    ? Math.round(pending.reduce((sum, s) => sum + s.daysAtCurrentLevel, 0) / pending.length)
    : 0;

  const handleDecision = async (id: string, decision: 'approved' | 'rejected') => {
    setActionLoading(id);
    try {
      // Find the submission to determine which JotForm field to update
      const sub = allSubmissions.find(s => s.id === id);
      if (!sub) throw new Error('Submission not found');

      // Field IDs for each approval level status
      const levelFieldMap: Record<number, { statusField: string; approverField: string; dateField: string }> = {
        1: { statusField: 'submission[8]', approverField: 'submission[9]', dateField: 'submission[10]' },
        2: { statusField: 'submission[11]', approverField: 'submission[12]', dateField: 'submission[13]' },
        3: { statusField: 'submission[14]', approverField: 'submission[15]', dateField: 'submission[16]' },
        4: { statusField: 'submission[17]', approverField: 'submission[18]', dateField: 'submission[19]' },
      };

      const lvl = typeof sub.currentApprovalLevel === 'number' ? sub.currentApprovalLevel : DIRECTOR.approvalLevel;
      const fields = levelFieldMap[lvl];
      if (!fields) throw new Error(`No field map for level ${lvl}`);

      const today = new Date();
      const dateStr = `${today.getMonth() + 1}-${String(today.getDate()).padStart(2,'0')}-${today.getFullYear()}`;

      // Build form-encoded body for JotForm submission update
      const params = new URLSearchParams();
      params.set(fields.statusField, decision === 'approved' ? 'Approved' : 'Rejected');
      params.set(fields.approverField, DIRECTOR.name);
      params.set(fields.dateField, dateStr);

      // If all 4 levels done or rejected, update overall status
      const isLastLevel = lvl === 4;
      if (decision === 'rejected' || isLastLevel) {
        params.set('submission[20]', decision === 'approved' ? 'Completed' : 'Rejected');
      } else {
        params.set('submission[20]', 'In Progress');
      }

      const res = await fetch(`/api/jotform-update?submissionId=${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      setDecisions(prev => ({ ...prev, [id]: decision }));

      // Trigger webhook sync so Supabase is updated too
      fetch(`/api/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionID: id }),
      }).catch(() => {});
    } catch (err) {
      console.error('Approval error:', err);
      alert(`Failed to submit decision: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(null);
    }
  };

  const priorityColor = (days: number) => {
    if (days > 14) return 'text-red-400';
    if (days > 7) return 'text-amber-400';
    return 'text-white';
  };

  const priorityBadge = (days: number) => {
    if (days > 14) return { label: 'Critical', cls: 'bg-red-500/20 text-red-400 border border-red-500/30' };
    if (days > 7) return { label: 'Delayed', cls: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' };
    return { label: 'On Track', cls: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' };
  };

  return (
    <div className="space-y-6">
      {/* Director Identity Banner */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-5 border border-purple-500/20"
      >
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-purple-500/20 flex items-center justify-center border border-purple-500/30">
            <Shield className="w-7 h-7 text-purple-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-white">{DIRECTOR.name}</h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30">
                Director · Level 3 Approver
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-sm text-gray-400">
              <Mail className="w-3.5 h-3.5" />
              <span>{DIRECTOR.email}</span>
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-3xl font-bold text-purple-400">{pending.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">Awaiting your decision</p>
          </div>
        </div>
      </motion.div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/20 flex items-center justify-center">
              <Clock className="w-4.5 h-4.5 text-purple-400" />
            </div>
            <p className="text-sm text-gray-400 font-medium">Pending Approval</p>
          </div>
          <p className="text-4xl font-bold text-white">{pending.length}</p>
          <p className="text-xs text-gray-500 mt-1">forms awaiting your review</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-red-500/20 flex items-center justify-center">
              <AlertTriangle className="w-4.5 h-4.5 text-red-400" />
            </div>
            <p className="text-sm text-gray-400 font-medium">Critical (&gt;7 days)</p>
          </div>
          <p className="text-4xl font-bold text-red-400">{critical.length}</p>
          <p className="text-xs text-gray-500 mt-1">need immediate attention</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center">
              <Clock className="w-4.5 h-4.5 text-amber-400" />
            </div>
            <p className="text-sm text-gray-400 font-medium">Avg. Wait Time</p>
          </div>
          <p className="text-4xl font-bold text-white">{avgDays}<span className="text-lg text-gray-500 ml-1">d</span></p>
          <p className="text-xs text-gray-500 mt-1">average days waiting</p>
        </motion.div>
      </div>

      {/* Approval Queue */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Pending Approvals — Your Queue</h3>
          {pending.length > 0 && (
            <span className="text-xs text-gray-500">
              Sorted by wait time (longest first)
            </span>
          )}
        </div>

        <div className="space-y-3">
          <AnimatePresence>
            {pending.map((sub, i) => {
              const badge = priorityBadge(sub.daysAtCurrentLevel);
              const isActioning = actionLoading === sub.id;

              return (
                <motion.div
                  key={sub.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20, height: 0, marginBottom: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.3 }}
                  className="glass-card p-5"
                >
                  <div className="flex items-start gap-4">
                    {/* Priority indicator */}
                    <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{
                      background: sub.daysAtCurrentLevel > 14 ? '#EF4444' : sub.daysAtCurrentLevel > 7 ? '#F59E0B' : '#8B5CF6'
                    }} />

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-gold">{sub.referenceNumber}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badge.cls}`}>
                          {badge.label}
                        </span>
                        <span className="text-xs text-gray-500">{sub.formTitle}</span>
                      </div>

                      <button
                        onClick={() => setSelectedSubmission(sub)}
                        className="text-left mt-1 group flex items-center gap-1 hover:text-gold transition-colors"
                      >
                        <p className="text-base font-semibold text-white group-hover:text-gold">{sub.title}</p>
                        <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-gold" />
                      </button>

                      <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-gray-500">
                        <span className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5" />
                          {sub.submittedBy.name}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5" />
                          {sub.submittedBy.department}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5" />
                          Submitted {sub.submissionDate}
                        </span>
                        <span className={`font-semibold ${priorityColor(sub.daysAtCurrentLevel)}`}>
                          {sub.daysAtCurrentLevel} days waiting
                        </span>
                      </div>
                    </div>

                    {/* Approve / Reject */}
                    <div className="flex flex-col sm:flex-row items-center gap-2 flex-shrink-0">
                      {isActioning ? (
                        <Loader2 className="w-5 h-5 text-gold animate-spin" />
                      ) : (
                        <>
                          <button
                            onClick={() => handleDecision(sub.id, 'approved')}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-400 text-sm font-semibold transition-all hover:scale-105"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            Approve
                          </button>
                          <button
                            onClick={() => handleDecision(sub.id, 'rejected')}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 text-sm font-semibold transition-all hover:scale-105"
                          >
                            <XCircle className="w-4 h-4" />
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {pending.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card p-16 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
              <p className="text-lg font-semibold text-white">All caught up!</p>
              <p className="text-sm text-gray-500 mt-1">No submissions pending your approval.</p>
            </motion.div>
          )}
        </div>
      </div>

      {/* Recently actioned (within this session) */}
      {Object.keys(decisions).length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Actioned This Session</h3>
          {Object.entries(decisions).map(([id, decision]) => {
            const sub = allSubmissions.find(s => s.id === id);
            if (!sub) return null;
            return (
              <div key={id} className="glass-card p-4 flex items-center gap-4 opacity-60">
                {decision === 'approved'
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  : <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{sub.title}</p>
                  <p className="text-xs text-gray-500">{sub.referenceNumber} · {sub.submittedBy.name}</p>
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  decision === 'approved'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-red-500/20 text-red-400'
                }`}>
                  {decision === 'approved' ? 'Approved' : 'Rejected'}
                </span>
              </div>
            );
          })}
        </motion.div>
      )}

      <SubmissionModal submission={selectedSubmission} onClose={() => setSelectedSubmission(null)} />
    </div>
  );
}
