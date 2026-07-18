import { useState, useEffect } from 'react';
import { FileText, Download, Search, Filter, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';

interface LogEntry {
  id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown>;
  created_at: string;
  user_name?: string;
}

const ACTION_COLORS: Record<string, string> = {
  login: 'text-blue-400',
  approval: 'text-emerald-400',
  rejection: 'text-red-400',
  export: 'text-purple-400',
  settings_change: 'text-amber-400',
  plan_change: 'text-gold',
  invite_member: 'text-cyan-400',
};

export default function ActivityLog() {
  const { organization } = useAuth();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    loadLogs();
  }, [organization]);

  const loadLogs = async () => {
    if (!organization) {
      // Demo data
      setLogs([
        { id: '1', user_id: '', action: 'login', entity_type: 'session', entity_id: '', details: {}, created_at: new Date().toISOString(), user_name: 'Ahmed Al Maktoum' },
        { id: '2', user_id: '', action: 'approval', entity_type: 'submission', entity_id: 'SUB-001', details: { level: 2 }, created_at: new Date(Date.now() - 3600000).toISOString(), user_name: 'Sara Hassan' },
        { id: '3', user_id: '', action: 'export', entity_type: 'report', entity_id: '', details: { format: 'PDF' }, created_at: new Date(Date.now() - 7200000).toISOString(), user_name: 'Omar Khalid' },
        { id: '4', user_id: '', action: 'rejection', entity_type: 'submission', entity_id: 'SUB-003', details: { reason: 'Incomplete documentation' }, created_at: new Date(Date.now() - 10800000).toISOString(), user_name: 'Fatima Ali' },
        { id: '5', user_id: '', action: 'settings_change', entity_type: 'org', entity_id: '', details: { field: 'SLA config' }, created_at: new Date(Date.now() - 14400000).toISOString(), user_name: 'Ahmed Al Maktoum' },
      ]);
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch<LogEntry[]>(`/api/activity-log?org_id=${organization.id}`);
      if (data) setLogs(data);
    } catch {}
    setLoading(false);
  };

  const filteredLogs = logs.filter(l => {
    if (searchTerm && !l.action.includes(searchTerm.toLowerCase()) && !(l.user_name || '').toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (actionFilter && l.action !== actionFilter) return false;
    if (dateFrom && l.created_at < dateFrom) return false;
    if (dateTo && l.created_at > dateTo + 'T23:59:59') return false;
    return true;
  });

  const exportCSV = () => {
    const header = 'Timestamp,User,Action,Entity Type,Entity ID,Details\n';
    const rows = filteredLogs.map(l =>
      `"${new Date(l.created_at).toISOString()}","${l.user_name || l.user_id}","${l.action}","${l.entity_type || ''}","${l.entity_id || ''}","${JSON.stringify(l.details || {})}"`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const actions = [...new Set(logs.map(l => l.action))];

  return (
    <div className="app-page space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <FileText className="w-7 h-7 text-gold" /> Activity Log
          </h1>
          <p className="text-gray-400 mt-1">Complete audit trail of all actions</p>
        </div>
        <button onClick={exportCSV} className="btn-outline flex items-center gap-2">
          <Download className="w-5 h-5" /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="glass-card p-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 py-2 rounded-xl bg-navy-dark border border-navy-light/30 text-white placeholder-gray-500 focus:border-gold/50 focus:outline-none"
            placeholder="Search actions or users..." />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-navy-dark border border-navy-light/30 text-white focus:border-gold/50 focus:outline-none text-sm">
            <option value="">All Actions</option>
            {actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="px-3 py-2 rounded-xl bg-navy-dark border border-navy-light/30 text-white focus:border-gold/50 focus:outline-none text-sm" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="px-3 py-2 rounded-xl bg-navy-dark border border-navy-light/30 text-white focus:border-gold/50 focus:outline-none text-sm" />
      </div>

      {/* Log table */}
      <div className="glass-card responsive-table">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 text-gold animate-spin" /></div>
        ) : (
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-navy-light/20">
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Timestamp</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">User</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Action</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Entity</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map(l => (
                <tr key={l.id} className="border-b border-navy-light/10 hover:bg-navy-light/10 transition-colors">
                  <td className="px-6 py-3 text-sm text-gray-400">{new Date(l.created_at).toLocaleString()}</td>
                  <td className="px-6 py-3 text-sm text-white">{l.user_name || l.user_id?.slice(0, 8) || '-'}</td>
                  <td className="px-6 py-3">
                    <span className={`text-sm font-medium ${ACTION_COLORS[l.action] || 'text-gray-300'}`}>{l.action}</span>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-400">{l.entity_type}{l.entity_id ? ` #${l.entity_id}` : ''}</td>
                  <td className="px-6 py-3 text-sm text-gray-500 max-w-xs truncate">{JSON.stringify(l.details)}</td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-500">No activity logs found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
