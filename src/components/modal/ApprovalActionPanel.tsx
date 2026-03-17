import {
  CheckCircle2, XCircle, AlertCircle, PenLine, Loader2,
} from 'lucide-react';
import { Submission } from '../../types';
import SignaturePad from '../SignaturePad';

interface Props {
  submission: Submission;
  comment: string;
  setComment: (v: string) => void;
  signature: string;
  setSignature: (v: string) => void;
  signatureRequired: boolean;
  approveEnabled: boolean;
  rejectEnabled: boolean;
  isDesignatedApprover: boolean;
  designatedApproverEmail: string;
  isSubmitting: boolean;
  approving: boolean;
  rejecting: boolean;
  uploadingSignature: boolean;
  confirmPending: 'approve' | 'reject' | null;
  setConfirmPending: (v: 'approve' | 'reject' | null) => void;
  handleApproval: (action: 'approve' | 'reject') => void;
  pushResult: { success: boolean; message: string } | null;
}

export default function ApprovalActionPanel({
  submission, comment, setComment, signature, setSignature,
  signatureRequired, approveEnabled, rejectEnabled,
  isDesignatedApprover, designatedApproverEmail,
  isSubmitting, approving, rejecting, uploadingSignature,
  confirmPending, setConfirmPending, handleApproval, pushResult,
}: Props) {
  return (
    <>
      {/* Steps indicator */}
      <div className="flex items-center gap-2 text-xs">
        <span className={`flex items-center gap-1 px-2 py-1 rounded-full font-medium ${comment.trim() ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
          <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]">{comment.trim() ? '\u2713' : '1'}</span>
          Comment
        </span>
        {signatureRequired && (
          <>
            <span className="text-gray-600">\u2192</span>
            <span className={`flex items-center gap-1 px-2 py-1 rounded-full font-medium ${signature ? 'bg-emerald-500/20 text-emerald-400' : 'bg-purple-500/20 text-purple-400'}`}>
              <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]">{signature ? '\u2713' : '2'}</span>
              Signature
            </span>
          </>
        )}
        <span className="text-gray-600">\u2192</span>
        <span className={`flex items-center gap-1 px-2 py-1 rounded-full font-medium ${approveEnabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-500'}`}>
          <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]">{signatureRequired ? '3' : '2'}</span>
          Approve
        </span>
      </div>

      {/* Step 1: Comment */}
      <div>
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400 mb-1.5">
          <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
          Step 1 — Comment <span className="text-gray-500 font-normal">(optional)</span>
        </label>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Enter your comment or reason for approval/rejection..."
          rows={2}
          className="w-full px-3 py-2 rounded-lg bg-navy-dark border border-navy-light/30 focus:border-gold/50 text-sm text-white placeholder-gray-600 focus:outline-none resize-none transition-colors"
        />
      </div>

      {/* Step 2: Signature */}
      {signatureRequired && (
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400 mb-1.5">
            <PenLine className="w-3.5 h-3.5 text-purple-400" />
            Step 2 — Digital Signature <span className="text-red-400 font-bold">*</span>
            <span className="text-gray-500 font-normal ml-1">required for Level {submission.currentApprovalLevel}</span>
          </label>
          {signature ? (
            <div className="relative border border-emerald-500/30 rounded-xl overflow-hidden bg-white">
              <img src={signature} alt="Signature" className="w-full object-contain" style={{ height: '150px' }} />
              <div className="absolute inset-0 flex items-center justify-end p-3">
                <button
                  onClick={() => setSignature('')}
                  className="px-2.5 py-1 rounded-lg bg-navy-dark/80 text-gray-400 hover:text-red-400 text-xs border border-navy-light/30 transition-colors"
                >
                  Re-sign
                </button>
              </div>
              <div className="absolute top-2 left-3 px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30">
                <span className="text-[10px] text-emerald-400 font-medium">{'\u2713'} Signature captured</span>
              </div>
            </div>
          ) : (
            <SignaturePad onSign={setSignature} height={150} />
          )}
        </div>
      )}

      {/* Step 3: Approve / Reject — two-click confirmation */}
      {confirmPending ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
          <p className="text-xs text-amber-400 font-medium text-center">
            {'\u26A0\uFE0F'} Confirm {submission.actionType === 'task' ? 'Task Completion' : confirmPending === 'approve' ? 'Approval' : 'Rejection'} — this cannot be undone
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setConfirmPending(null); handleApproval(confirmPending); }}
              disabled={isSubmitting}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 ${
                confirmPending === 'approve'
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-red-600 hover:bg-red-500 text-white'
              }`}
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : confirmPending === 'approve' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {uploadingSignature ? 'Saving signature...' : approving || rejecting ? 'Submitting...' : submission.actionType === 'task' ? 'Yes, Mark Complete' : `Yes, ${confirmPending === 'approve' ? 'Approve' : 'Reject'}`}
            </button>
            <button
              type="button"
              onClick={() => setConfirmPending(null)}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl font-semibold text-sm bg-navy-light/30 text-gray-400 hover:text-white transition-all disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 pt-1">
          {!isDesignatedApprover && designatedApproverEmail && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-xs text-amber-300">
                Awaiting approval from <span className="font-semibold">{designatedApproverEmail}</span>
              </p>
            </div>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmPending('approve')}
              disabled={!approveEnabled || isSubmitting}
              title={!isDesignatedApprover ? `Only ${designatedApproverEmail} can approve at this level` : ''}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-all"
            >
              <CheckCircle2 className="w-4 h-4" /> Approve & Sign
            </button>
            <button
              type="button"
              onClick={() => setConfirmPending('reject')}
              disabled={!rejectEnabled || isSubmitting}
              title={!isDesignatedApprover ? `Only ${designatedApproverEmail} can reject at this level` : ''}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-all"
            >
              <XCircle className="w-4 h-4" /> Reject
            </button>
          </div>
        </div>
      )}

      {/* What's still needed */}
      {signatureRequired && !signature && (
        <div className="text-xs text-amber-400/80 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
          <p>{'\u2192'} Draw your signature above to enable Approve</p>
        </div>
      )}

      {pushResult && (
        <div className={`p-3 rounded-lg text-sm font-medium ${
          pushResult.success
            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
            : 'bg-red-500/20 text-red-400 border border-red-500/30'
        }`}>
          {pushResult.success ? '\u2705 Successfully pushed to JotForm Enterprise!' : `\u274C ${pushResult.message}`}
        </div>
      )}
    </>
  );
}
