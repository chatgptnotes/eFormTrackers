import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2, Zap, ToggleLeft, ToggleRight, Sparkles, RefreshCw,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { useAuth } from '../contexts/AuthContext';
import {
  JotformKeyType,
  getJotformKeyTypeFor,
  setJotformKeyType,
} from '../lib/jotformKey';

export default function Settings() {
  const { autoApproveRules, setAutoApproveRules } = useApp();
  const { user } = useAuth();
  const [keyType, setKeyTypeState] = useState<JotformKeyType>(() =>
    getJotformKeyTypeFor(user?.email)
  );
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    setKeyTypeState(getJotformKeyTypeFor(user?.email));
  }, [user?.email]);

  const handleKeyTypeChange = async (next: JotformKeyType) => {
    if (next === keyType) return;
    setSwitching(true);
    setJotformKeyType(next, user?.email);
    setKeyTypeState(next);
    // Clear formDiscovery's localStorage caches so the new source's forms/questions are re-fetched
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('jotflow_q') || k.startsWith('jotflow_forms'))) {
          localStorage.removeItem(k);
        }
      }
    } catch {}
    setSwitching(false);
  };

  const toggleRule = (ruleId: string) => {
    setAutoApproveRules(autoApproveRules.map(r =>
      r.id === ruleId ? { ...r, enabled: !r.enabled } : r
    ));
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h2 className="text-2xl font-bold text-white">API Configuration</h2>
        <p className="text-sm text-gray-500 mt-1">Manage the JotForm API source and approval automation.</p>
      </motion.div>

      {/* API Source switch (Old key ↔ GDMO key) */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="glass-card p-6 space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <RefreshCw className={`w-5 h-5 text-emerald-400 ${switching ? 'animate-spin' : ''}`} />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-white">JotForm API Source</h3>
            <p className="text-xs text-gray-500">
              Switch between the original API key and the GDMO enterprise key.
              {user?.email && (
                <> Choice is saved for <span className="text-gray-400">{user.email}</span>.</>
              )}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleKeyTypeChange('default')}
            disabled={switching}
            className={`px-4 py-3 rounded-xl border text-left transition-colors disabled:opacity-50 ${
              keyType === 'default'
                ? 'border-gold/60 bg-gold/10'
                : 'border-navy-light/30 bg-navy-dark/40 hover:border-navy-light/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Default key</span>
              {keyType === 'default' && <CheckCircle2 className="w-4 h-4 text-gold" />}
            </div>
            <p className="text-xs text-gray-500 mt-1">JOTFORM_API_KEY (original)</p>
          </button>

          <button
            type="button"
            onClick={() => handleKeyTypeChange('gdmo')}
            disabled={switching}
            className={`px-4 py-3 rounded-xl border text-left transition-colors disabled:opacity-50 ${
              keyType === 'gdmo'
                ? 'border-gold/60 bg-gold/10'
                : 'border-navy-light/30 bg-navy-dark/40 hover:border-navy-light/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">GDMO key</span>
              {keyType === 'gdmo' && <CheckCircle2 className="w-4 h-4 text-gold" />}
            </div>
            <p className="text-xs text-gray-500 mt-1">JOTFORM_API_KEY_GDMO</p>
          </button>
        </div>

        <p className="text-xs text-gray-500">
          Active source: <span className="text-gray-300 font-mono">{keyType}</span>. Switching
          clears cached forms/submissions so the dashboard reloads from the selected source.
        </p>
      </motion.div>

      {/* Connection — managed by the backend poller */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-6 space-y-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gold/10"><Zap className="w-5 h-5 text-gold" /></div>
          <div>
            <h3 className="text-sm font-semibold text-white">JotForm Connection</h3>
            <p className="text-xs text-gray-500">Managed automatically by the backend</p>
          </div>
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">
          The server connects to JotForm using its configured API key and polls for new
          submissions every couple of minutes, writing the results to the database. The
          dashboard reads from there — no API key, connection test, or form discovery is
          needed here.
        </p>
      </motion.div>

      {/* Auto-Approve Rules */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10"><Sparkles className="w-5 h-5 text-purple-400" /></div>
          <div>
            <h3 className="text-sm font-semibold text-white">Auto-Approve Rules</h3>
            <p className="text-xs text-gray-500">Configure conditions for automatic approval of requests</p>
          </div>
        </div>
        <div className="space-y-3">
          {autoApproveRules.map(rule => (
            <div key={rule.id} className="flex items-center justify-between px-4 py-3 rounded-lg bg-navy-dark/50">
              <div className="flex-1">
                <p className="text-sm text-white">{rule.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Action: <span className="text-gray-400">{rule.action}</span>
                  {rule.conditions.formTypes && <> • Forms: <span className="text-gray-400">{rule.conditions.formTypes.join(', ')}</span></>}
                  {rule.conditions.maxDaysAtLevel && <> • Max days: <span className="text-gray-400">{rule.conditions.maxDaysAtLevel}</span></>}
                  {rule.conditions.maxPriority && <> • Max priority: <span className="text-gray-400">{rule.conditions.maxPriority}</span></>}
                </p>
              </div>
              <button
                onClick={() => toggleRule(rule.id)}
                className="ml-3 flex-shrink-0"
              >
                {rule.enabled ? (
                  <ToggleRight className="w-8 h-8 text-gold" />
                ) : (
                  <ToggleLeft className="w-8 h-8 text-gray-600" />
                )}
              </button>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Sync Status */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="glass-card p-4">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm text-gray-300">Syncing automatically from the backend</span>
        </div>
      </motion.div>
    </div>
  );
}
