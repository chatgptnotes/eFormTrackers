import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2, Zap, ToggleLeft, ToggleRight, Sparkles, RefreshCw,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';
import {
  JotformKeyType,
  getJotformKeyTypeFor,
  setJotformKeyType,
} from '../lib/jotformKey';

interface ApiProfile {
  id: string;
  label: string;
  scope: string;
  default: boolean;
  configured: boolean;
}

interface SyncSummary {
  totalUpserted: number;
  totalFailed: number;
  formCount: number;
  elapsedMs: number;
  perForm?: Array<{ formId: string; formTitle: string; total: number; upserted: number }>;
}

export default function Settings() {
  const { autoApproveRules, setAutoApproveRules } = useApp();
  const { user } = useAuth();
  const [keyType, setKeyTypeState] = useState<JotformKeyType>(() =>
    getJotformKeyTypeFor(user?.email)
  );
  const [switching, setSwitching] = useState(false);
  const [profiles, setProfiles] = useState<ApiProfile[]>([]);

  useEffect(() => {
    setKeyTypeState(getJotformKeyTypeFor(user?.email));
  }, [user?.email]);

  useEffect(() => {
    apiFetch<{ profiles: ApiProfile[] }>('/api/profiles')
      .then(d => setProfiles(d.profiles || []))
      .catch(() => setProfiles([]));
  }, []);

  // Which profile id is effectively active (explicit choice, else the default).
  const activeProfileId = keyType || profiles.find(p => p.default)?.id || '';

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

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncLog, setSyncLog] = useState<string[]>([]);

  const handleSyncAll = () => {
    if (syncing) return;
    if (!confirm(`Sync ALL ${keyType === 'gdmo' ? 'Production' : 'Testing'} submissions to the database? This may take several minutes for large datasets.`)) return;
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    setSyncLog([]);

    // EventSource is GET-only and can't carry custom headers, so pass the
    // key type as a query param. Cookies (session) are forwarded automatically.
    const url = `/api/admin/sync-all-stream?keyType=${encodeURIComponent(keyType)}`;
    const es = new EventSource(url, { withCredentials: true });

    const append = (line: string) => setSyncLog(log => [...log, line]);

    es.addEventListener('start', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      append(`Starting sync of ${d.formCount} forms (key=${d.keyType})`);
    });

    es.addEventListener('form-start', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      append(`Fetching ${d.formTitle}…`);
    });

    es.addEventListener('form-done', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      append(`✓ ${d.formTitle}: 200 — ${d.upserted}/${d.total} (${(d.ms / 1000).toFixed(1)}s)`);
    });

    es.addEventListener('form-error', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      append(`✗ ${d.formTitle}: ${d.status} — ${d.error}`);
    });

    es.addEventListener('done', (e: MessageEvent) => {
      const d = JSON.parse(e.data) as SyncSummary & { ok: boolean };
      setSyncResult({ ...d, perForm: d.perForm || [] });
      setSyncing(false);
      es.close();
    });

    // Native 'error' on EventSource fires for both transport errors and
    // server-emitted `event: error`. Either way we close and surface a message.
    es.addEventListener('error', () => {
      // If the stream already finished cleanly, readyState is CLOSED; ignore.
      if (es.readyState === EventSource.CLOSED) {
        setSyncing(false);
        return;
      }
      setSyncError('Stream connection lost');
      setSyncing(false);
      es.close();
    });
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

      {/* API profile picker — choose which configured JotForm API to use */}
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
            <h3 className="text-sm font-semibold text-white">JotForm API Profile</h3>
            <p className="text-xs text-gray-500">
              Choose which configured JotForm API the dashboard reads from.
              {user?.email && (
                <> Choice is saved for <span className="text-gray-400">{user.email}</span>.</>
              )}
            </p>
          </div>
        </div>

        {profiles.length === 0 ? (
          <p className="text-xs text-gray-500">No API profiles configured. Add them in <code>backend/config/jotform-profiles.json</code>.</p>
        ) : (
          <div className="flex items-center gap-3">
            <select
              value={activeProfileId}
              onChange={e => handleKeyTypeChange(e.target.value)}
              disabled={switching}
              className="flex-1 px-3 py-2 rounded-xl bg-navy-dark border border-navy-light/30 text-white text-sm focus:border-gold/50 focus:outline-none disabled:opacity-50"
            >
              {profiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.label} [{p.scope}]{p.default ? ' • default' : ''}{p.configured ? '' : ' • no key'}
                </option>
              ))}
            </select>
            {switching && <Loader2 className="w-4 h-4 text-gold animate-spin" />}
          </div>
        )}
        <p className="text-xs text-gray-500">
          Switching changes only what you see — each API's data is stored separately. To pull a
          new API's data the first time, an admin runs <code>node scripts/sync-profile.js &lt;id&gt;</code>.
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

      {/* Full DB Sync (admin) */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }} className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <RefreshCw className={`w-5 h-5 text-emerald-400 ${syncing ? 'animate-spin' : ''}`} />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-white">Sync All Submissions</h3>
            <p className="text-xs text-gray-500">
              Pull every submission from every form on the active key ({keyType === 'gdmo' ? 'Production' : 'Testing'}) and upsert into jf_submissions. Runs server-side so it's not bottlenecked by your browser.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSyncAll}
          disabled={syncing}
          className="w-full px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
        >
          {syncing ? 'Syncing…' : `Sync All ${keyType === 'gdmo' ? 'Production' : 'Testing'} Submissions`}
        </button>
        {syncError && <p className="text-xs text-red-400">Error: {syncError}</p>}
        {syncLog.length > 0 && (
          <div className="max-h-64 overflow-y-auto text-xs font-mono space-y-0.5 bg-black/30 rounded p-2">
            {syncLog.slice(-50).map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith('✓')
                    ? 'text-emerald-400'
                    : line.startsWith('✗')
                      ? 'text-red-400'
                      : 'text-gray-400'
                }
              >
                {line}
              </div>
            ))}
          </div>
        )}
        {syncResult && (
          <div className="text-xs text-gray-400 space-y-1 mt-2 max-h-48 overflow-y-auto">
            <p className="text-emerald-400 font-semibold">
              ✓ Upserted {syncResult.totalUpserted} across {syncResult.formCount} forms in {(syncResult.elapsedMs / 1000).toFixed(1)}s
              {syncResult.totalFailed > 0 && <span className="text-amber-400"> ({syncResult.totalFailed} failed)</span>}
            </p>
            {(syncResult.perForm || []).filter(f => f.total > 0).slice(0, 8).map(f => (
              <p key={f.formId} className="font-mono">
                {f.upserted}/{f.total} — {f.formTitle}
              </p>
            ))}
          </div>
        )}
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
