import { ExternalLink, FileText } from 'lucide-react';
import { JFFormMeta } from '../services/formDiscovery';
import { jotformUrl } from '../config/jotform';

interface Props {
  activeForms?: JFFormMeta[];
}

export default function SubmitRequest({ activeForms }: Props) {
  const forms = activeForms || [];

  return (
    <div className="app-page max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Submit a New Request</h1>
        <p className="text-gray-400 text-sm">Choose a form below. It will open in JotForm where you can fill and submit your request. Once submitted, it will appear in the approvers' dashboard automatically.</p>
      </div>

      {forms.length === 0 ? (
        <div className="glass-card p-8 text-center border border-navy-light/20 rounded-2xl">
          <p className="text-gray-400 text-sm">No active forms found. Forms will appear here once your JotForm account has enabled workflows.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {forms.map((form, idx) => {
            const isGold = idx % 2 === 0;
            return (
              <div
                key={form.id}
                className={`glass-card p-6 border ${isGold ? 'border-gold/20' : 'border-blue-500/20'} rounded-2xl`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${isGold ? 'bg-gold/20' : 'bg-blue-500/20'}`}>
                    <FileText className={`w-6 h-6 ${isGold ? 'text-gold' : 'text-blue-400'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-semibold text-white mb-1">{form.title}</h2>
                    <p className="text-sm text-gray-400 mb-4">Submit a request using this form. It will go through the configured approval workflow.</p>

                    <a
                      href={jotformUrl(form.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                        isGold
                          ? 'bg-gold/20 text-gold hover:bg-gold/30 border border-gold/30'
                          : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30'
                      }`}
                    >
                      <FileText className="w-4 h-4" />
                      Fill &amp; Submit Form
                      <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8 p-4 rounded-xl bg-navy-light/20 border border-navy-light/20">
        <p className="text-xs text-gray-500">
          <span className="text-gray-400 font-medium">What happens after you submit?</span> Your request will appear in the approvers' dashboard within minutes. You can track its progress in the Workflow Tracker page.
        </p>
      </div>
    </div>
  );
}
