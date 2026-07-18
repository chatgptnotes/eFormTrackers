import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

interface WorkflowOption {
  id: string;
  title: string;
}

interface Props {
  value: string | null;
  options: WorkflowOption[];
  onChange: (id: string | null) => void;
  accent?: 'blue' | 'emerald' | 'amber';
}

const accentClass = {
  blue: 'focus-within:border-blue-500 focus-within:ring-blue-500/20',
  emerald: 'focus-within:border-emerald-400 focus-within:ring-emerald-400/30',
  amber: 'focus-within:border-amber-500 focus-within:ring-amber-500/20',
};

export default function WorkflowPicker({ value, options, onChange, accent = 'blue' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.id === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(o => o.title.toLowerCase().includes(q)) : options;
  }, [options, query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const choose = (id: string | null) => {
    onChange(id);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative w-full sm:w-72">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-left text-sm font-semibold text-gray-800 shadow-sm ring-2 ring-transparent transition-all ${accentClass[accent]}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{selected?.title || 'All Workflows'}</span>
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
              placeholder="Search workflows..."
              className="w-full px-9 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1" role="listbox">
            <button type="button" onClick={() => choose(null)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">
              <Check className={`h-4 w-4 ${!value ? 'opacity-100' : 'opacity-0'}`} />
              <span>All Workflows</span>
            </button>
            {filtered.map(option => (
              <button key={option.id} type="button" onClick={() => choose(option.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">
                <Check className={`h-4 w-4 flex-shrink-0 ${value === option.id ? 'opacity-100' : 'opacity-0'}`} />
                <span className="truncate">{option.title}</span>
              </button>
            ))}
            {filtered.length === 0 && <div className="px-3 py-4 text-sm text-gray-500">No workflows found</div>}
          </div>
        </div>
      )}
    </div>
  );
}
