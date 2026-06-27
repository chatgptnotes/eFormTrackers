import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, RefreshCw, ExternalLink, CheckCircle2, XCircle, FileText, ClipboardList, ChevronDown, ChevronUp, Inbox, Search } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface ActionLink {
  label: string;
  type: 'approve' | 'reject' | 'fill' | 'task';
  url: string;
}

// Mirrors the jf_email_archive columns returned by GET /api/admin/emails.
interface ArchivedEmail {
  email_id: string;
  submission_id: string;
  form_id: string;
  form_title: string;
  email_type: string;
  to_addr: string;
  from_addr: string;
  subject: string;
  preview: string;
  sent_at: string | null;
}

interface ArchivedEmailDetail extends ArchivedEmail {
  body_html: string;
  actionLinks: ActionLink[];
}

const PAGE_SIZE = 50;

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
      onClick={e => e.stopPropagation()}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${styles[link.type] || styles.task}`}
    >
      {icons[link.type]}
      {link.label}
      <ExternalLink className="w-3 h-3 opacity-60" />
    </a>
  );
}

function EmailCard({ email }: { email: ArchivedEmail }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ArchivedEmailDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail && !loadingDetail) {
      setLoadingDetail(true);
      try {
        const d = await apiFetch<ArchivedEmailDetail>(`/api/admin/emails/${email.email_id}`);
        setDetail(d);
      } catch {
        /* leave detail null — the card still shows preview */
      } finally {
        setLoadingDetail(false);
      }
    }
  };

  const formatted = email.sent_at
    ? new Date(email.sent_at).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '—';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm"
    >
      <div className="flex items-start gap-4 p-4 cursor-pointer hover:bg-gray-50 transition-colors" onClick={toggle}>
        <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-blue-50 border border-blue-100 mt-0.5">
          <Mail className="w-4 h-4 text-blue-600" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900 truncate">{email.subject || '(no subject)'}</p>
            <span className="text-[11px] text-gray-400 flex-shrink-0">{formatted}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            To: <span className="text-gray-700">{email.to_addr || '—'}</span>
            {email.form_title ? <> · {email.form_title}</> : null}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{email.preview || 'No preview available'}</p>
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
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-gray-400">From:</span> <span className="text-gray-700">{email.from_addr || '—'}</span></div>
                <div><span className="text-gray-400">Type:</span> <span className="text-gray-700">{email.email_type || 'unknown'}</span></div>
                <div><span className="text-gray-400">Submission:</span> <span className="text-gray-700">{email.submission_id || '—'}</span></div>
                <div><span className="text-gray-400">Form:</span> <span className="text-gray-700">{email.form_id || '—'}</span></div>
              </div>

              {loadingDetail && (
                <p className="text-xs text-gray-400 flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading email body…
                </p>
              )}

              {detail && detail.actionLinks.length > 0 && (
                <div>
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide font-semibold mb-2">Actions</p>
                  <div className="flex flex-wrap gap-2">
                    {detail.actionLinks.map(l => <ActionButton key={l.type} link={l} />)}
                  </div>
                </div>
              )}

              {detail && (
                <div>
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Message</p>
                  <div
                    className="text-sm text-gray-700 leading-relaxed border border-gray-100 rounded-lg p-3 max-h-96 overflow-auto bg-gray-50"
                    dangerouslySetInnerHTML={{ __html: detail.body_html || '<em>No body</em>' }}
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function AdminEmails() {
  const [emails, setEmails] = useState<ArchivedEmail[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');   // committed search term
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextOffset: number, term: string, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextOffset) });
      if (term) params.set('q', term);
      const data = await apiFetch<{ total: number; rows: ArchivedEmail[] }>(`/api/admin/emails?${params.toString()}`);
      setTotal(data.total);
      setOffset(nextOffset);
      setEmails(prev => (append ? [...prev, ...data.rows] : data.rows));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load emails');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(0, search, false); }, [load, search]);

  // Force a server-side archive pass, then reload the first page.
  const refresh = async () => {
    setRefreshing(true);
    try {
      await apiFetch('/api/admin/emails/refresh', { method: 'POST' });
    } catch {
      /* archive refresh is best-effort — still reload what we have */
    } finally {
      setRefreshing(false);
      await load(0, search, false);
    }
  };

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(query.trim());
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Inbox className="w-6 h-6 text-blue-600" />
            All Emails
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Every email JotForm sent across the workspace — archived from the enterprise log.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading || refreshing}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white hover:bg-gray-50 text-gray-700 hover:text-gray-900 text-sm transition-all border border-gray-300 shadow-sm"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {/* Search */}
      <form onSubmit={onSearchSubmit} className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search subject, preview or recipient…"
          className="w-full pl-9 pr-24 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <button type="submit" className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">
          Search
        </button>
      </form>

      {/* Stats */}
      {!error && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-sm">
          <p className="text-2xl font-bold text-gray-900">{total}</p>
          <p className="text-xs text-gray-500 mt-0.5">{search ? `Emails matching “${search}”` : 'Archived emails'}</p>
        </div>
      )}

      {/* States */}
      {loading && emails.length === 0 && (
        <div className="text-center py-20 text-gray-500">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-blue-500" />
          <p className="text-sm">Loading emails…</p>
        </div>
      )}

      {!loading && error && (
        <div className="text-center py-16 text-red-500">
          <XCircle className="w-8 h-8 mx-auto mb-3 opacity-60" />
          <p className="text-sm font-medium">{error}</p>
          <button onClick={() => load(0, search, false)} className="mt-3 text-xs text-blue-600 hover:underline">Try again</button>
        </div>
      )}

      {!loading && !error && emails.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <Mail className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No emails archived yet</p>
          <p className="text-xs mt-1 text-gray-400">Click “Sync now” to pull the latest from JotForm</p>
        </div>
      )}

      {emails.length > 0 && (
        <div className="space-y-3">
          {emails.map(email => <EmailCard key={email.email_id} email={email} />)}

          {emails.length < total && (
            <div className="text-center pt-2">
              <button
                onClick={() => load(offset + PAGE_SIZE, search, true)}
                disabled={loading}
                className="px-4 py-2 rounded-xl bg-white border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 shadow-sm"
              >
                {loading ? 'Loading…' : `Load more (${emails.length}/${total})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
