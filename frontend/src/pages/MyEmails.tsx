import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, RefreshCw, ExternalLink, CheckCircle2, XCircle, FileText, ClipboardList, ChevronDown, ChevronUp, Inbox } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface ActionLink {
  label: string;
  type: 'approve' | 'reject' | 'fill' | 'task';
  url: string;
}

interface WorkflowEmail {
  emailId: string;
  subject: string;
  sentAt: string | null;
  to: string;
  preview: string;
  actionLinks: ActionLink[];
}

function ActionButton({ link }: { link: ActionLink }) {
  const styles: Record<string, string> = {
    approve: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
    reject:  'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
    fill:    'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
    task:    'bg-gray-50 text-gray-700 border-gray-300 hover:bg-gray-100',
  };
  const icons: Record<string, React.ReactNode> = {
    approve: <CheckCircle2 className="w-3.5 h-3.5" />,
    reject:  <XCircle className="w-3.5 h-3.5" />,
    fill:    <FileText className="w-3.5 h-3.5" />,
    task:    <ClipboardList className="w-3.5 h-3.5" />,
  };

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${styles[link.type] || styles.task}`}
    >
      {icons[link.type]}
      {link.label}
      <ExternalLink className="w-3 h-3 opacity-60" />
    </a>
  );
}

function EmailCard({ email }: { email: WorkflowEmail }) {
  const [expanded, setExpanded] = useState(false);

  const formatted = email.sentAt
    ? new Date(email.sentAt).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '—';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm"
    >
      <div
        className="flex items-start gap-4 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-blue-50 border border-blue-100 mt-0.5">
          <Mail className="w-4 h-4 text-blue-600" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900 truncate">{email.subject}</p>
            <span className="text-[11px] text-gray-400 flex-shrink-0">{formatted}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{email.preview || 'No preview available'}</p>

          {email.actionLinks.length > 0 && !expanded && (
            <div className="flex flex-wrap gap-2 mt-2">
              {email.actionLinks.map(l => (
                <ActionButton key={l.type} link={l} />
              ))}
            </div>
          )}
        </div>

        <button className="text-gray-400 hover:text-gray-700 flex-shrink-0 mt-1">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-gray-200"
          >
            <div className="p-4 pt-3 space-y-3">
              <div>
                <p className="text-[11px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Message Preview</p>
                <p className="text-sm text-gray-700 leading-relaxed">{email.preview}</p>
              </div>

              {email.actionLinks.length > 0 && (
                <div>
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide font-semibold mb-2">Actions</p>
                  <div className="flex flex-wrap gap-2">
                    {email.actionLinks.map(l => (
                      <ActionButton key={l.type} link={l} />
                    ))}
                  </div>
                </div>
              )}

              {email.actionLinks.length === 0 && (
                <p className="text-xs text-gray-400 italic">No action links detected in this email.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function MyEmails() {
  const { user } = useAuth();
  const [emails, setEmails] = useState<WorkflowEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ emails: WorkflowEmail[]; total: number }>('/api/my-workflow-emails');
      setEmails(data.emails);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load emails');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pendingCount = emails.filter(e => e.actionLinks.length > 0).length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Inbox className="w-6 h-6 text-blue-600" />
            My Workflow Emails
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            JotForm workflow notifications sent to{' '}
            <span className="text-blue-600">{user?.email}</span>
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white hover:bg-gray-50 text-gray-700 hover:text-gray-900 text-sm transition-all border border-gray-300 shadow-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      {!loading && !error && (
        <div className="flex gap-4">
          <div className="flex-1 bg-white border border-gray-200 rounded-xl p-4 text-center shadow-sm">
            <p className="text-2xl font-bold text-gray-900">{emails.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">Total Emails</p>
          </div>
          <div className="flex-1 bg-white border border-gray-200 rounded-xl p-4 text-center shadow-sm">
            <p className="text-2xl font-bold text-amber-500">{pendingCount}</p>
            <p className="text-xs text-gray-500 mt-0.5">With Actions</p>
          </div>
        </div>
      )}

      {/* States */}
      {loading && (
        <div className="text-center py-20 text-gray-500">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-blue-500" />
          <p className="text-sm">Loading your workflow emails…</p>
          <p className="text-xs text-gray-400 mt-1">Fetching from JotForm — this may take a moment</p>
        </div>
      )}

      {!loading && error && (
        <div className="text-center py-16 text-red-500">
          <XCircle className="w-8 h-8 mx-auto mb-3 opacity-60" />
          <p className="text-sm font-medium">{error}</p>
          <button onClick={load} className="mt-3 text-xs text-blue-600 hover:underline">Try again</button>
        </div>
      )}

      {!loading && !error && emails.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <Mail className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No workflow emails found</p>
          <p className="text-xs mt-1 text-gray-400">JotForm hasn't sent any workflow emails to your address yet</p>
        </div>
      )}

      {!loading && !error && emails.length > 0 && (
        <div className="space-y-3">
          {emails.map(email => (
            <EmailCard key={email.emailId} email={email} />
          ))}
        </div>
      )}
    </div>
  );
}
