import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Clock, User, Building2, AlertTriangle, Eye, Flag } from 'lucide-react';
import { Submission } from '../types';
import { useApp } from '../contexts/AppContext';
import SubmissionModal from '../components/SubmissionModal';

interface Props {
  data: ReturnType<typeof import('../hooks/useSubmissions').useSubmissions>;
}

const COLUMNS = [
  { key: 1, label: 'Level 1 — Department', color: '#3B82F6', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  { key: 2, label: 'Level 2 — Division', color: '#F59E0B', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  { key: 3, label: 'Level 3 — Director', color: '#8B5CF6', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
  { key: 4, label: 'Level 4 — Executive', color: '#EF4444', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  { key: 'completed', label: 'Completed', color: '#10B981', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
];

const priorityColors: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-amber-400',
  medium: 'text-blue-400',
  low: 'text-gray-400',
};

export default function KanbanBoard({ data }: Props) {
  const { allSubmissions } = data;
  const { isWatched, toggleWatch, getSLAStatus } = useApp();
  const [selected, setSelected] = useState<Submission | null>(null);
  const [dragItem, setDragItem] = useState<string | null>(null);

  const columns = useMemo(() => {
    return COLUMNS.map(col => ({
      ...col,
      items: allSubmissions
        .filter(s => s.currentApprovalLevel === col.key)
        .sort((a, b) => b.daysAtCurrentLevel - a.daysAtCurrentLevel)
        .slice(0, 30),
      total: allSubmissions.filter(s => s.currentApprovalLevel === col.key).length,
    }));
  }, [allSubmissions]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Kanban Board — Approval Pipeline</h2>
        <div className="text-xs text-gray-500">Showing top 30 per column • Drag to simulate movement</div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 200px)' }}>
        {columns.map((col, ci) => (
          <motion.div
            key={col.key}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: ci * 0.1 }}
            className={`flex-shrink-0 w-72 ${col.bg} border ${col.border} rounded-2xl flex flex-col`}
            onDragOver={e => e.preventDefault()}
          >
            <div className="p-4 border-b border-white/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: col.color }} />
                  <h3 className="text-sm font-bold text-white">{col.label}</h3>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-white/10 text-white">{col.total}</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {col.items.map((sub, i) => {
                const sla = typeof sub.currentApprovalLevel === 'number'
                  ? getSLAStatus(sub.currentApprovalLevel, sub.daysAtCurrentLevel) : 'green';
                return (
                  <motion.div
                    key={sub.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: ci * 0.1 + i * 0.02 }}
                    draggable
                    onDragStart={() => setDragItem(sub.id)}
                    onDragEnd={() => setDragItem(null)}
                    onClick={() => setSelected(sub)}
                    className={`bg-navy/80 backdrop-blur border border-navy-light/20 rounded-xl p-3 cursor-pointer hover:border-gold/30 transition-all ${dragItem === sub.id ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-xs font-mono text-gold">{sub.referenceNumber}</span>
                      <div className="flex items-center gap-1">
                        <Flag className={`w-3 h-3 ${priorityColors[sub.priority]}`} />
                        {sla === 'red' && <AlertTriangle className="w-3 h-3 text-red-400" />}
                        {sla === 'yellow' && <Clock className="w-3 h-3 text-amber-400" />}
                        <button onClick={e => { e.stopPropagation(); toggleWatch(sub.id); }} className="ml-1">
                          <Eye className={`w-3 h-3 ${isWatched(sub.id) ? 'text-gold' : 'text-gray-600'}`} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs font-medium text-white truncate">{sub.title}</p>
                    <p className="text-xs text-gray-500 mt-1">{sub.formTitle}</p>
                    <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1"><User className="w-3 h-3" />{sub.submittedBy.name.split(' ')[0]}</span>
                      <span className={`font-bold ${sla === 'red' ? 'text-red-400' : sla === 'yellow' ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {sub.daysAtCurrentLevel}d
                      </span>
                    </div>
                    {/* SLA bar */}
                    <div className="mt-2 h-1 rounded-full bg-navy-light/30 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${sla === 'red' ? 'bg-red-500' : sla === 'yellow' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${Math.min(100, (sub.daysAtCurrentLevel / 14) * 100)}%` }}
                      />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        ))}
      </div>

      <SubmissionModal submission={selected} onClose={() => setSelected(null)} onUpdate={(_id, _lvl, _status) => { setSelected(null); data.refresh({ force: true }); }} />
    </div>
  );
}
