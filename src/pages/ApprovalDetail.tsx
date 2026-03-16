import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Clock, User, Building2, Calendar } from 'lucide-react';
import { Submission } from '../types';
import SubmissionModal from '../components/SubmissionModal';

interface Props {
  data: ReturnType<typeof import('../hooks/useSubmissions').useSubmissions>;
}

const levelInfo: Record<string, { title: string; description: string; color: string; bg: string }> = {
  '1': { title: 'Level 1 — Department Approval', description: 'Initial review by department head', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  '2': { title: 'Level 2 — Division Approval', description: 'Review by division manager', color: 'text-amber-400', bg: 'bg-amber-500/20' },
  '3': { title: 'Level 3 — Director Approval', description: 'Review by director', color: 'text-purple-400', bg: 'bg-purple-500/20' },
  '4': { title: 'Level 4 — Executive Approval', description: 'Final executive sign-off', color: 'text-red-400', bg: 'bg-red-500/20' },
};

export default function ApprovalDetail({ data }: Props) {
  const { level } = useParams();
  const navigate = useNavigate();
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const info = levelInfo[level || '1'] || levelInfo['1'];

  const submissions = data.allSubmissions
    .filter(s => String(s.currentApprovalLevel) === level)
    .sort((a, b) => b.daysAtCurrentLevel - a.daysAtCurrentLevel);

  const avgDays = submissions.length > 0
    ? Math.round(submissions.reduce((s, i) => s + i.daysAtCurrentLevel, 0) / submissions.length)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/app')} className="p-2 rounded-xl hover:bg-navy-light/30 text-gray-400 hover:text-white">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className={`text-2xl font-bold ${info.color}`}>{info.title}</h2>
          <p className="text-sm text-gray-500">{info.description}</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-card p-5">
          <p className="text-sm text-gray-400">Pending Approvals</p>
          <p className="text-3xl font-bold text-white mt-1">{submissions.length}</p>
        </div>
        <div className="glass-card p-5">
          <p className="text-sm text-gray-400">Average Wait</p>
          <p className="text-3xl font-bold text-white mt-1">{avgDays} <span className="text-sm text-gray-500">days</span></p>
        </div>
        <div className="glass-card p-5">
          <p className="text-sm text-gray-400">Critical (&gt;7 days)</p>
          <p className="text-3xl font-bold text-red-400 mt-1">{submissions.filter(s => s.daysAtCurrentLevel > 7).length}</p>
        </div>
      </div>

      {/* Submissions List */}
      <div className="space-y-3">
        {submissions.map((sub, i) => (
          <motion.div
            key={sub.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03 }}
            onClick={() => setSelectedSubmission(sub)}
            className="glass-card-hover p-4 cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className={`w-12 h-12 rounded-xl ${info.bg} flex items-center justify-center`}>
                  <Clock className={`w-5 h-5 ${info.color}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gold">{sub.referenceNumber}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold status-${sub.overallStatus}`}>
                      {sub.overallStatus}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white mt-0.5 truncate">{sub.title}</p>
                  <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><User className="w-3 h-3" />{sub.submittedBy.name}</span>
                    <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{sub.submittedBy.department}</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{sub.submissionDate}</span>
                  </div>
                </div>
              </div>
              <div className="text-right ml-4">
                <p className={`text-2xl font-bold ${sub.daysAtCurrentLevel > 14 ? 'text-red-400' : sub.daysAtCurrentLevel > 7 ? 'text-amber-400' : 'text-white'}`}>
                  {sub.daysAtCurrentLevel}d
                </p>
                <p className="text-xs text-gray-500">at this level</p>
              </div>
            </div>

            {/* Approver */}
            {sub.approvalHistory.filter(a => a.status === 'pending').map((a, j) => {
              const isGeneric = /^Level \d+ Approver$/.test(a.approverName) || a.approverName === 'Approver';
              return (
                <div key={j} className="mt-3 pt-3 border-t border-navy-light/10 flex items-center gap-2 text-xs text-gray-400">
                  <User className="w-3 h-3" />
                  <span>Pending approval from: <span className={isGeneric ? 'text-amber-400 italic' : 'text-white font-medium'}>
                    {isGeneric ? 'Pending Review' : a.approverName}
                    {a.approverEmail && !a.approverName.includes('@') && (
                      <span className="text-gray-500 font-normal ml-1">({a.approverEmail})</span>
                    )}
                  </span></span>
                </div>
              );
            })}
          </motion.div>
        ))}

        {submissions.length === 0 && (
          <div className="glass-card p-12 text-center">
            <p className="text-gray-500">No submissions at this approval level</p>
          </div>
        )}
      </div>

      <SubmissionModal submission={selectedSubmission} onClose={() => setSelectedSubmission(null)} />
    </div>
  );
}
