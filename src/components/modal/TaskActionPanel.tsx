import { AlertCircle, ClipboardList, Loader2 } from 'lucide-react';

interface Props {
  isDesignatedApprover: boolean;
  designatedApproverEmail: string;
  isSubmitting: boolean;
  approving: boolean;
  comment: string;
  setComment: (v: string) => void;
  setConfirmPending: (v: 'approve' | 'reject' | null) => void;
  pushResult: { success: boolean; message: string } | null;
}

export default function TaskActionPanel({
  isDesignatedApprover, designatedApproverEmail,
  isSubmitting, approving,
  comment, setComment, setConfirmPending, pushResult,
}: Props) {
  return (
    <div className="space-y-3">
      {!isDesignatedApprover && designatedApproverEmail && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-xs text-amber-300">
            Task assigned to <span className="font-semibold">{designatedApproverEmail}</span>
          </p>
        </div>
      )}
      <p className="text-sm text-gray-400">
        Review the task details and mark it complete when done.
      </p>
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="Task completion note (optional)..."
        rows={2}
        className="w-full px-3 py-2 rounded-lg bg-navy-light/30 border border-navy-light/40 text-white text-sm placeholder-gray-500 resize-none focus:outline-none focus:border-gold/40"
      />
      {pushResult && (
        <div className={`p-3 rounded-lg text-sm ${pushResult.success ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-red-500/10 text-red-300 border border-red-500/20'}`}>
          {pushResult.message}
        </div>
      )}
      <button
        onClick={() => setConfirmPending('approve')}
        disabled={!isDesignatedApprover || isSubmitting}
        title={!isDesignatedApprover ? `Only ${designatedApproverEmail} can complete this task` : ''}
        className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-gold/20 hover:bg-gold/30 disabled:opacity-30 disabled:cursor-not-allowed text-gold rounded-xl font-semibold text-sm border border-gold/20 transition-all"
      >
        {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />}
        {approving ? 'Marking Complete...' : 'Mark Task Complete'}
      </button>
    </div>
  );
}
