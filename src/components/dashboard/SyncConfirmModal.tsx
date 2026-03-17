import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Submission } from '../../types';

interface Props {
  submission: Submission;
  loading: boolean;
  onConfirm: (sub: Submission, action: 'approve' | 'reject') => void;
  onClose: () => void;
}

export default function SyncConfirmModal({ submission, loading, onConfirm, onClose }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => !loading && onClose()}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="glass-card p-6 max-w-sm w-full mx-4 border border-amber-500/30"
      >
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          <h3 className="text-lg font-bold text-white">Sync Native Action</h3>
        </div>
        <p className="text-sm text-gray-300 mb-1">
          <span className="text-gold font-mono">{submission.referenceNumber}</span> — {submission.submittedBy.name}
        </p>
        <p className="text-sm text-gray-400 mb-4">
          This submission was acted upon in JotForm's native inbox but the dashboard fields weren't updated. What was the action?
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => onConfirm(submission, 'approve')}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Approved
          </button>
          <button
            onClick={() => onConfirm(submission, 'reject')}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
            Rejected
          </button>
        </div>
        <button
          onClick={onClose}
          disabled={loading}
          className="w-full mt-3 px-4 py-2 rounded-lg text-gray-500 hover:text-gray-300 text-xs transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </motion.div>
    </motion.div>
  );
}
