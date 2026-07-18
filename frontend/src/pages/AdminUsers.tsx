import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, RefreshCw, ChevronDown, ChevronUp, Search, XCircle, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api';

// Mirrors the jf_users columns returned by GET /api/admin/users.
interface DirUser {
  jf_id: string;
  username: string;
  email: string;
  name: string;
  account_type: string;
  status: string;
  avatar_url: string;
  last_login: string | null;
  created_at_jf: string | null;
  synced_at: string | null;
}
interface DirUserDetail extends DirUser {
  raw: unknown;
}

const PAGE_SIZE = 50;

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

function UserCard({ u }: { u: DirUser }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<DirUserDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail && !loading) {
      setLoading(true);
      try { setDetail(await apiFetch<DirUserDetail>(`/api/admin/users/${encodeURIComponent(u.jf_id)}`)); }
      catch { /* keep summary */ }
      finally { setLoading(false); }
    }
  };

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50 transition-colors" onClick={toggle}>
        <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 text-sm font-semibold">
          {(u.name || u.email || '?').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{u.name || u.username || '(no name)'}</p>
          <p className="text-xs text-gray-500 truncate">{u.email || '—'}</p>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px] font-semibold">
          <ShieldCheck className="w-3 h-3" />{u.account_type || 'USER'}
        </span>
        <button className="text-gray-400 hover:text-gray-700 flex-shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="border-t border-gray-200">
            <div className="p-4 pt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-gray-400">Username:</span> <span className="text-gray-700">{u.username || '—'}</span></div>
                <div><span className="text-gray-400">Status:</span> <span className="text-gray-700">{u.status || '—'}</span></div>
                <div><span className="text-gray-400">Last login:</span> <span className="text-gray-700">{fmt(u.last_login)}</span></div>
                <div><span className="text-gray-400">Created:</span> <span className="text-gray-700">{fmt(u.created_at_jf)}</span></div>
              </div>
              {loading && <p className="text-xs text-gray-400 flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading…</p>}
              {detail && (
                <div>
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide font-semibold mb-1">All details (raw)</p>
                  <pre className="text-[11px] text-gray-700 bg-gray-50 border border-gray-100 rounded-lg p-3 max-h-72 overflow-auto">
                    {JSON.stringify(detail.raw, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function AdminUsers() {
  const [users, setUsers] = useState<DirUser[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextOffset: number, term: string, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextOffset) });
      if (term) params.set('q', term);
      const data = await apiFetch<{ total: number; rows: DirUser[] }>(`/api/admin/users?${params.toString()}`);
      setTotal(data.total);
      setOffset(nextOffset);
      setUsers(prev => (append ? [...prev, ...data.rows] : data.rows));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(0, search, false); }, [load, search]);

  const refresh = async () => {
    setRefreshing(true);
    try { await apiFetch('/api/admin/users/refresh', { method: 'POST' }); }
    catch { /* best-effort */ }
    finally { setRefreshing(false); await load(0, search, false); }
  };

  return (
    <div className="app-page max-w-3xl mx-auto space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-600" />
            All Users
          </h1>
          <p className="text-sm text-gray-500 mt-1">Every user the active JotForm API can see, with role and full details.</p>
        </div>
        <button onClick={refresh} disabled={loading || refreshing}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white hover:bg-gray-50 text-gray-700 text-sm border border-gray-300 shadow-sm">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); }} className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, email or username…"
          className="w-full pl-9 pr-24 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
        <button type="submit" className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700">Search</button>
      </form>

      {!error && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-sm">
          <p className="text-2xl font-bold text-gray-900">{total}</p>
          <p className="text-xs text-gray-500 mt-0.5">{search ? `Users matching “${search}”` : 'Users in directory'}</p>
        </div>
      )}

      {loading && users.length === 0 && (
        <div className="text-center py-20 text-gray-500">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-indigo-500" />
          <p className="text-sm">Loading users…</p>
        </div>
      )}

      {!loading && error && (
        <div className="text-center py-16 text-red-500">
          <XCircle className="w-8 h-8 mx-auto mb-3 opacity-60" />
          <p className="text-sm font-medium">{error}</p>
          <button onClick={() => load(0, search, false)} className="mt-3 text-xs text-indigo-600 hover:underline">Try again</button>
        </div>
      )}

      {!loading && !error && users.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No users synced yet</p>
          <p className="text-xs mt-1 text-gray-400">Click “Sync now” to pull the directory for this API</p>
        </div>
      )}

      {users.length > 0 && (
        <div className="space-y-3">
          {users.map(u => <UserCard key={u.jf_id} u={u} />)}
          {users.length < total && (
            <div className="text-center pt-2">
              <button onClick={() => load(offset + PAGE_SIZE, search, true)} disabled={loading}
                className="px-4 py-2 rounded-xl bg-white border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 shadow-sm">
                {loading ? 'Loading…' : `Load more (${users.length}/${total})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
