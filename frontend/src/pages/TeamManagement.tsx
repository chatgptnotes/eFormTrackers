import { useState, useEffect, useMemo, useRef } from 'react';
import { Users, Shield, Loader2, RefreshCw, AlertTriangle, UserPlus, Mail, Lock, X, CheckCircle2, Search, ChevronDown, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';
import { ApiError, messageFromStatus, humanizeError } from '../lib/errors';
import { Submission } from '../types';

interface Props {
  data?: ReturnType<typeof import('../hooks/useSubmissions').useSubmissions>;
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string;
  joinedAt: string;
  accountType: string;
  source?: 'workspace' | 'assigned';
}

interface FilterOption {
  id: string;
  label: string;
}

const ROLE_OPTIONS = [
  { value: 'super_admin', label: 'Super Admin', desc: 'Full access to everything' },
  { value: 'admin', label: 'Admin', desc: 'Manage team, approve/reject, all tools' },
  { value: 'approver', label: 'Approver', desc: 'Approve/reject assigned submissions' },
  { value: 'viewer', label: 'Viewer', desc: 'View only assigned forms, no actions' },
  { value: 'user', label: 'User', desc: 'Sees only assigned forms; can act on assigned tasks' },
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
  if (r === 'external_assignee')
    return { label: 'Assigned User', className: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' };
  if (r === 'user' || r === 'member')
    return { label: 'Member', className: 'bg-purple-500/20 text-purple-400 border-purple-500/30' };
  return { label: role || accountType || 'Member', className: 'bg-gray-500/20 text-gray-400 border-gray-500/30' };
}

function getAccountTypeBadge(accountType: string): { label: string; className: string } {
  const t = (accountType || '').toLowerCase();
  if (t === 'admin') return { label: 'Admin', className: 'bg-gold/20 text-gold' };
  if (t === 'user') return { label: 'User', className: 'bg-blue-500/20 text-blue-400' };
  if (t === 'assigned') return { label: 'Assigned', className: 'bg-cyan-500/20 text-cyan-400' };
  if (t === 'data_only_user') return { label: 'Data Only', className: 'bg-gray-500/20 text-gray-400' };
  return { label: accountType || '-', className: 'bg-gray-500/20 text-gray-400' };
}

function collectAssignedUsers(submissions: Submission[], members: TeamMember[]): TeamMember[] {
  const seen = new Set(members.map(m => m.email?.trim().toLowerCase()).filter(Boolean));
  const assigned = new Map<string, TeamMember>();
  const add = (email?: string, name?: string) => {
    const e = email?.trim().toLowerCase();
    if (!e || seen.has(e) || assigned.has(e)) return;
    assigned.set(e, {
      id: `assigned-${e}`,
      name: name?.trim() || email!.split('@')[0],
      email: email!.trim(),
      role: 'external_assignee',
      avatarUrl: '',
      joinedAt: '',
      accountType: 'assigned',
      source: 'assigned',
    });
  };

  submissions.forEach(sub => {
    add(sub.pendingApproverEmail, sub.pendingApproverName);
    sub.workflowTasks?.forEach(task => add(task.assigneeEmail, task.assigneeName));
  });

  return [...assigned.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function TeamFilterDropdown({ value, options, onChange }: { value: string; options: FilterOption[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.id === value) || options[0];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={ref} className="relative w-full sm:w-72">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-navy-light/30 bg-navy-dark px-3 py-2.5 text-left text-sm font-medium text-white hover:border-gold/50"
      >
        <span className="truncate">{selected?.label || 'All users'}</span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-2 w-full overflow-hidden rounded-xl border border-navy-light/30 bg-navy-dark shadow-2xl">
          <div className="relative border-b border-navy-light/20">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search filters..."
              className="w-full bg-transparent px-9 py-2.5 text-sm text-white outline-none placeholder:text-gray-500"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.map(option => (
              <button
                key={option.id}
                type="button"
                onClick={() => { onChange(option.id); setQuery(''); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-300 hover:bg-navy-light/30 hover:text-white"
              >
                <Check className={`h-4 w-4 flex-shrink-0 ${value === option.id ? 'opacity-100' : 'opacity-0'}`} />
                <span className="truncate">{option.label}</span>
              </button>
            ))}
            {filtered.length === 0 && <div className="px-3 py-4 text-sm text-gray-500">No filters found</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TeamManagement({ data }: Props) {
  const { user, orgRole } = useAuth();
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
  const [teamFilter, setTeamFilter] = useState('all');
  const [teamSearch, setTeamSearch] = useState('');

  const canCreateUser = orgRole === 'super_admin' || orgRole === 'admin';
  const assignedUsers = useMemo(
    () => collectAssignedUsers(data?.allSubmissions || [], members),
    [data?.allSubmissions, members],
  );
  const displayedMembers = useMemo(
    () => [...members.map(m => ({ ...m, source: 'workspace' as const })), ...assignedUsers],
    [members, assignedUsers],
  );
  const filterOptions = useMemo(() => {
    const roles = new Map<string, string>();
    displayedMembers.forEach(m => {
      const label = getRoleBadge(m.role, m.accountType).label;
      roles.set(`role:${label.toLowerCase()}`, label);
    });
    return [
      { id: 'all', label: 'All users' },
      { id: 'source:workspace', label: 'Member' },
      { id: 'source:assigned', label: 'Assigned User' },
      ...[...roles].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [displayedMembers]);
  const filteredMembers = useMemo(() => {
    const q = teamSearch.trim().toLowerCase();
    return displayedMembers.filter(m => {
      const roleLabel = getRoleBadge(m.role, m.accountType).label;
      const matchesFilter =
        teamFilter === 'all' ||
        (teamFilter === 'source:workspace' && m.source === 'workspace') ||
        (teamFilter === 'source:assigned' && m.source === 'assigned') ||
        (teamFilter.startsWith('role:') && teamFilter === `role:${roleLabel.toLowerCase()}`);
      if (!matchesFilter) return false;
      if (!q) return true;
      return (
        m.name?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q) ||
        roleLabel.toLowerCase().includes(q) ||
        getAccountTypeBadge(m.accountType).label.toLowerCase().includes(q)
      );
    });
  }, [displayedMembers, teamFilter, teamSearch]);

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
    <div className="app-page space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Users className="w-7 h-7 text-gold" /> Team Management
            {!loading && filteredMembers.length > 0 && (
              <span className="text-base font-normal text-gray-400">({filteredMembers.length} users)</span>
            )}
          </h1>
          <p className="text-gray-400 mt-1">Workspace members plus users assigned to workflow tasks or forms</p>
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
            <div className="responsive-panel-grid">
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
            <div className="responsive-panel-grid">
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <TeamFilterDropdown value={teamFilter} options={filterOptions} onChange={setTeamFilter} />
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={teamSearch}
            onChange={e => setTeamSearch(e.target.value)}
            placeholder="Search name, email, role"
            className="w-full rounded-xl border border-navy-light/30 bg-navy-dark py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-gold/50 focus:outline-none"
          />
        </div>
      </div>

      <div className="glass-card responsive-table">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-gold animate-spin" />
          </div>
        ) : (
          <table className="w-full min-w-[820px]">
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
              {filteredMembers.map((m, idx) => {
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
              {filteredMembers.length === 0 && !error && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    No users match the current filter
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
