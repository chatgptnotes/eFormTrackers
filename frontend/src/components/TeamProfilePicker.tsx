import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { apiFetch } from '../lib/api';
import { getJotformKeyType, getJotformKeyTypeFor, setJotformKeyType } from '../lib/jotformKey';

interface ApiProfile {
  id: string;
  label: string;
  scope: string;
  teamId: string;
  default: boolean;
  configured: boolean;
}

export default function TeamProfilePicker() {
  const { user } = useAuth();
  const { setActiveWorkflowId } = useApp();
  const [profiles, setProfiles] = useState<ApiProfile[]>([]);
  const [value, setValue] = useState(() => getJotformKeyTypeFor(user?.email));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = getJotformKeyTypeFor(user?.email);
    setValue(next);
    if (next && next !== getJotformKeyType()) setJotformKeyType(next, user?.email);
  }, [user?.email]);

  useEffect(() => {
    apiFetch<{ profiles: ApiProfile[] }>('/api/jotform-profiles')
      .then(d => {
        const configured = (d.profiles || []).filter(p => p.configured);
        const teams = configured.filter(p => p.teamId);
        const byWorkspace = new Map<string, ApiProfile>();
        [...teams, ...configured.filter(p => !p.teamId && !p.id.endsWith('__all'))].forEach(p => {
          const key = p.teamId ? `team:${p.teamId}` : `profile:${p.id}`;
          if (!byWorkspace.has(key)) byWorkspace.set(key, p);
        });
        setProfiles([...byWorkspace.values()]);
      })
      .catch(() => setProfiles([]));
  }, []);

  const fallback = profiles.find(p => p.default)?.id || profiles[0]?.id || '';
  const active = profiles.some(p => p.id === value) ? value : fallback;
  const selected = profiles.find(p => p.id === active);

  useEffect(() => {
    if (!fallback || profiles.some(p => p.id === value)) return;
    setJotformKeyType(fallback, user?.email);
    setValue(fallback);
  }, [fallback, profiles, user?.email, value]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(p =>
      p.label.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.teamId.toLowerCase().includes(q)
    );
  }, [profiles, query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const choose = (id: string) => {
    setJotformKeyType(id, user?.email);
    setValue(id);
    setActiveWorkflowId(null);
    setQuery('');
    setOpen(false);
  };

  if (profiles.length === 0) return null;

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex h-16 w-full items-center justify-between gap-2 rounded-xl border border-gray-300 bg-white px-3 text-left text-sm font-semibold text-gray-800 shadow-sm ring-2 ring-transparent transition-all focus:border-blue-500 focus:outline-none focus:ring-blue-500/20"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-500">Team Workspace</span>
          <span className="block truncate">{selected?.label || selected?.id || 'Select team workspace'}</span>
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-2 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="relative border-b border-gray-100">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search team workspace..."
              className="w-full px-9 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1" role="listbox">
            {filtered.map(p => (
              <button key={p.id} type="button" onClick={() => choose(p.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">
                <Check className={`h-4 w-4 flex-shrink-0 ${active === p.id ? 'opacity-100' : 'opacity-0'}`} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.label || p.id}</span>
                  <span className="block truncate text-xs text-gray-500">{p.id}{p.teamId ? ` - Team ${p.teamId}` : ' - No teamID'}</span>
                </span>
              </button>
            ))}
            {filtered.length === 0 && <div className="px-3 py-4 text-sm text-gray-500">No team workspaces found</div>}
          </div>
        </div>
      )}
    </div>
  );
}
