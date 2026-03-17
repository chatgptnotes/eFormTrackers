import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { ApprovalEntry } from '../../types';

interface Props {
  history: ApprovalEntry[];
}

export default function ApprovalTimeline({ history }: Props) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-300 mb-4">Approval Timeline</h4>
      <div className="space-y-0">
        {history.map((entry, i) => (
          <div key={i} className="flex items-start gap-4">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                entry.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' :
                entry.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                'bg-amber-500/20 text-amber-400'
              }`}>
                {entry.status === 'approved' ? <CheckCircle2 className="w-4 h-4" /> :
                 entry.status === 'rejected' ? <XCircle className="w-4 h-4" /> :
                 <Clock className="w-4 h-4" />}
              </div>
              {i < history.length - 1 && (
                <div className="w-px h-10 bg-navy-light/30" />
              )}
            </div>
            <div className="pb-6">
              {(() => {
                const isGeneric = /^Level \d+ Approver$/.test(entry.approverName) || entry.approverName === 'Approver';
                return (
                  <p className="text-sm font-medium text-white">
                    Level {entry.level} — {isGeneric && entry.status === 'pending'
                      ? <span className="text-amber-400 italic font-normal">Pending Review</span>
                      : <>
                          {entry.approverName}
                          {entry.approverEmail && !entry.approverName.includes('@') && (
                            <span className="text-xs text-gray-400 font-normal ml-1">({entry.approverEmail})</span>
                          )}
                        </>
                    }
                  </p>
                );
              })()}
              <p className="text-xs text-gray-500 mt-0.5">
                {entry.status === 'pending' ? 'Pending approval' : `${entry.status} on ${entry.date}`}
              </p>
              {entry.comments && <p className="text-xs text-gray-400 mt-1 italic">"{entry.comments}"</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
