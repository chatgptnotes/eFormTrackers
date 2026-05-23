import { useState, useEffect } from 'react';
import { Users, Shield, Loader2, RefreshCw, AlertTriangle, UserPlus, Mail, Lock, X, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';
import { ApiError, messageFromStatus, humanizeError } from '../lib/errors';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string;
  joinedAt: string;
  accountType: string;
}

const ROLE_OPTIONS = [
  { value: 'super_admin', label: 'Super Admin', desc: 'Full access to everything' },
  { value: 'admin', label: 'Admin', desc: 'Manage team, approve/reject, all tools' },
  { value: 'approver', label: 'Approver', desc: 'Approve/reject assigned submissions' },
  { value: 'viewer', label: 'Viewer', desc: 'View only assigned forms, no actions' },
];

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
  const { user } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create user form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newDepartment, setNewDepartment] = useState('');
  const [newRole, setNewRole] = useState('viewer');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const canCreateUser = user?.email === 'bk@bettroi.com';

  const loadMembers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ members?: TeamMember[] }>('/api/team-members');
      setMembers(data.members || []);
    } catch (err) {
      console.error('Failed to load team members:', err);
      setError(humanizeError(err, 'Could not load team members. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);

    try {
      const data = await apiFetch<{ user?: { email: string; role: string }; error?: string }>('/api/create-user', {
        method: 'POST',
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          fullName: newFullName,
          department: newDepartment,
          role: newRole,
          creatorEmail: user?.email,
        }),
        throwOnError: false,
      });
      if (!data.user) {
        throw new ApiError(messageFromStatus(0, data.error), 0, data.error);
      }
      setCreateSuccess(`User ${data.user.email} created as ${data.user.role}`);
      setNewEmail('');
      setNewPassword('');
      setNewFullName('');
      setNewDepartment('');
      setNewRole('viewer');
      // Refresh member list
      loadMembers();
    } catch (err) {
      setCreateError(humanizeError(err, 'Could not create the user. Please try again.'));
    } finally {
      setCreating(false);
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
          <p className="text-gray-400 mt-1">Workspace team members and their roles</p>
        </div>
        <div className="flex items-center gap-3">
          {false && canCreateUser && (
            <button
              onClick={() => { setShowCreateForm(!showCreateForm); setCreateError(null); setCreateSuccess(null); }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                showCreateForm
                  ? 'bg-gold text-navy-dark border border-gold'
                  : 'bg-gold/20 text-gold border border-gold/30 hover:bg-gold/30'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              Create User
            </button>
          )}
          <button
            onClick={loadMembers}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-navy-dark text-gray-400 border border-navy-light/30 hover:border-gold/50 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Create User Form */}
      {showCreateForm && canCreateUser && (
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Create New User</h3>
            <button onClick={() => setShowCreateForm(false)} className="text-gray-500 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {createSuccess && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-sm text-emerald-400">{createSuccess}</span>
            </div>
          )}

          {createError && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className="text-sm text-red-400">{createError}</span>
            </div>
          )}

          <form onSubmit={handleCreateUser} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Email *</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-navy-dark border border-navy-light/30 text-white text-sm focus:border-gold/50 focus:outline-none"
                    placeholder="user@example.com"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Password *</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-navy-dark border border-navy-light/30 text-white text-sm focus:border-gold/50 focus:outline-none"
                    placeholder="Min 6 characters"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Full Name</label>
                <input
                  type="text"
                  value={newFullName}
                  onChange={e => setNewFullName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-navy-dark border border-navy-light/30 text-white text-sm focus:border-gold/50 focus:outline-none"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Department</label>
                <input
                  type="text"
                  value={newDepartment}
                  onChange={e => setNewDepartment(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-navy-dark border border-navy-light/30 text-white text-sm focus:border-gold/50 focus:outline-none"
                  placeholder="Operations"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Role *</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {ROLE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setNewRole(opt.value)}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      newRole === opt.value
                        ? 'border-gold bg-gold/10 text-white'
                        : 'border-navy-light/30 bg-navy-dark text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-[11px] mt-0.5 opacity-70">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={creating}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gold text-navy-dark font-medium text-sm hover:bg-gold/90 disabled:opacity-50 transition-colors"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                {creating ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </form>
        </div>
      )}

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
