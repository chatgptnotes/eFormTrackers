import { useState, useEffect } from 'react';
import { Users, Shield, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string;
  joinedAt: string;
  accountType: string;
}

function getRoleBadge(role: string, accountType: string): { label: string; className: string } {
  const r = (role || accountType || '').toLowerCase();
  if (r.includes('super_admin') || r.includes('superadmin') || r === 'owner')
    return { label: 'Super Admin', className: 'bg-red-500/20 text-red-400 border-red-500/30' };
  if (r === 'admin' || r.includes('admin'))
    return { label: 'Admin', className: 'bg-gold/20 text-gold border-gold/30' };
  if (r.includes('write') || r === 'collaborator' || r === 'editor')
    return { label: 'Read & Write', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' };
  if (r.includes('read') || r === 'viewer' || r === 'readonly' || r === 'data_only_user')
    return { label: 'View Only', className: 'bg-gray-500/20 text-gray-400 border-gray-500/30' };
  if (r === 'user' || r === 'member')
    return { label: 'Member', className: 'bg-purple-500/20 text-purple-400 border-purple-500/30' };
  return { label: role || accountType || 'Member', className: 'bg-gray-500/20 text-gray-400 border-gray-500/30' };
}

function getAccountTypeBadge(accountType: string): { label: string; className: string } {
  const t = (accountType || '').toLowerCase();
  if (t === 'admin') return { label: 'Admin', className: 'bg-gold/20 text-gold' };
  if (t === 'user') return { label: 'User', className: 'bg-blue-500/20 text-blue-400' };
  if (t === 'data_only_user') return { label: 'Data Only', className: 'bg-gray-500/20 text-gray-400' };
  return { label: accountType || '-', className: 'bg-gray-500/20 text-gray-400' };
}

export default function TeamManagement() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMembers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/team-members');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `API error: ${res.status}`);
      }
      setMembers(data.members || []);
    } catch (err) {
      console.error('Failed to load team members:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMembers();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Users className="w-7 h-7 text-gold" /> Team Management
            {!loading && members.length > 0 && (
              <span className="text-base font-normal text-gray-400">({members.length} members)</span>
            )}
          </h1>
          <p className="text-gray-400 mt-1">Workspace team members and their roles from JotForm</p>
        </div>
        <button
          onClick={loadMembers}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-navy-dark text-gray-400 border border-navy-light/30 hover:border-gold/50 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="glass-card p-4 border border-red-500/30 bg-red-500/5">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-red-400 font-medium">Failed to load team members</p>
              <p className="text-xs text-gray-500 mt-0.5">{error}</p>
            </div>
            <button onClick={loadMembers} className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors">
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-gold animate-spin" />
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-navy-light/20">
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Member</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Email</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Role / Permission</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Account Type</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, idx) => {
                const badge = getRoleBadge(m.role, m.accountType);
                const acctBadge = getAccountTypeBadge(m.accountType);
                return (
                  <tr key={m.id || idx} className="border-b border-navy-light/10 hover:bg-navy-light/10 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gold/20 flex items-center justify-center text-gold font-semibold">
                          {(m.name || m.email || '?')[0].toUpperCase()}
                        </div>
                        <span className="text-white font-medium">{m.name || m.email?.split('@')[0] || 'Unknown'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-400 text-sm">{m.email || '-'}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg text-sm border ${badge.className}`}>
                        <Shield className="w-3 h-3" /> {badge.label}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${acctBadge.className}`}>
                        {acctBadge.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-400 text-sm">
                      {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : '-'}
                    </td>
                  </tr>
                );
              })}
              {members.length === 0 && !error && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    No team members found in the JotForm workspace
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
