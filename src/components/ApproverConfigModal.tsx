import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Save, Loader2, Users, CheckCircle2 } from 'lucide-react';

interface ApproverRow {
  formId: string;
  formTitle: string;
  level: number;
  approverName: string;
  approverEmail: string;
  saved: boolean;
  saving: boolean;
}

interface Props {
  activeForms: { id: string; title: string }[];
  onClose: () => void;
  onSaved?: () => void;
}

export default function ApproverConfigModal({ activeForms, onClose, onSaved }: Props) {
  const [rows, setRows] = useState<ApproverRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/approver-config');
        const data = await res.json();
        const configs = data.configs || [];

        // Build rows: for each form, levels 1-4
        const newRows: ApproverRow[] = [];
        for (const form of activeForms) {
          for (let level = 1; level <= 4; level++) {
            const existing = configs.find((c: Record<string, unknown>) => String(c.form_id) === form.id && Number(c.level) === level);
            newRows.push({
              formId: form.id,
              formTitle: form.title,
              level,
              approverName: existing?.approver_name || '',
              approverEmail: existing?.approver_email || '',
              saved: !!existing?.approver_name,
              saving: false,
            });
          }
        }
        setRows(newRows);
      } catch {
        // Build empty rows
        const newRows: ApproverRow[] = [];
        for (const form of activeForms) {
          for (let level = 1; level <= 4; level++) {
            newRows.push({ formId: form.id, formTitle: form.title, level, approverName: '', approverEmail: '', saved: false, saving: false });
          }
        }
        setRows(newRows);
      } finally {
        setLoading(false);
      }
    })();
  }, [activeForms]);

  const updateRow = (formId: string, level: number, field: 'approverName' | 'approverEmail', value: string) => {
    setRows(prev => prev.map(r =>
      r.formId === formId && r.level === level ? { ...r, [field]: value, saved: false } : r
    ));
  };

  const saveRow = async (formId: string, level: number) => {
    const row = rows.find(r => r.formId === formId && r.level === level);
    if (!row) return;

    setRows(prev => prev.map(r =>
      r.formId === formId && r.level === level ? { ...r, saving: true } : r
    ));

    try {
      const res = await fetch('/api/approver-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formId,
          level,
          approverName: row.approverName.trim(),
          approverEmail: row.approverEmail.trim(),
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      setRows(prev => prev.map(r =>
        r.formId === formId && r.level === level ? { ...r, saving: false, saved: true } : r
      ));
      onSaved?.();
    } catch {
      setRows(prev => prev.map(r =>
        r.formId === formId && r.level === level ? { ...r, saving: false } : r
      ));
    }
  };

  const saveAll = async () => {
    const unsaved = rows.filter(r => (r.approverName || r.approverEmail) && !r.saved);
    for (const row of unsaved) {
      await saveRow(row.formId, row.level);
    }
  };

  // Group by form
  const formGroups = activeForms.map(form => ({
    ...form,
    levels: rows.filter(r => r.formId === form.id),
  }));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="glass-card w-full max-w-4xl max-h-[85vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="p-6 border-b border-navy-light/20 flex items-center justify-between sticky top-0 bg-navy-dark/95 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gold/20">
              <Users className="w-5 h-5 text-gold" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Configure Approvers</h3>
              <p className="text-xs text-gray-500">Set who approves at each level per form</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={saveAll}
              className="px-4 py-2 rounded-lg bg-gold/20 text-gold hover:bg-gold/30 text-sm font-medium flex items-center gap-2 transition-colors"
            >
              <Save className="w-4 h-4" /> Save All
            </button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-navy-light/30 text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-gold animate-spin" />
            </div>
          ) : (
            formGroups.map(form => (
              <div key={form.id} className="bg-navy-light/10 rounded-xl border border-navy-light/20 overflow-hidden">
                <div className="px-4 py-3 border-b border-navy-light/20 bg-navy-light/5">
                  <h4 className="text-sm font-semibold text-white">{form.title}</h4>
                  <p className="text-xs text-gray-500">Form ID: {form.id}</p>
                </div>
                <div className="divide-y divide-navy-light/10">
                  {form.levels.map(row => (
                    <div key={row.level} className="flex items-center gap-3 px-4 py-2.5">
                      <span className={`w-16 text-xs font-bold px-2 py-1 rounded-full text-center ${
                        row.level === 1 ? 'bg-blue-500/20 text-blue-400' :
                        row.level === 2 ? 'bg-amber-500/20 text-amber-400' :
                        row.level === 3 ? 'bg-purple-500/20 text-purple-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>L{row.level}</span>
                      <input
                        type="text"
                        value={row.approverName}
                        onChange={e => updateRow(form.id, row.level, 'approverName', e.target.value)}
                        placeholder="Approver name..."
                        className="flex-1 px-3 py-1.5 rounded-lg bg-navy-dark border border-navy-light/30 text-sm text-white placeholder-gray-600 focus:border-gold/50 focus:outline-none"
                      />
                      <input
                        type="email"
                        value={row.approverEmail}
                        onChange={e => updateRow(form.id, row.level, 'approverEmail', e.target.value)}
                        placeholder="email@domain.com"
                        className="flex-1 px-3 py-1.5 rounded-lg bg-navy-dark border border-navy-light/30 text-sm text-white placeholder-gray-600 focus:border-gold/50 focus:outline-none"
                      />
                      <button
                        onClick={() => saveRow(form.id, row.level)}
                        disabled={row.saving || (!row.approverName && !row.approverEmail)}
                        className="p-1.5 rounded-lg hover:bg-navy-light/30 disabled:opacity-30 transition-colors"
                      >
                        {row.saving ? (
                          <Loader2 className="w-4 h-4 text-gold animate-spin" />
                        ) : row.saved ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Save className="w-4 h-4 text-gray-400 hover:text-gold" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
