import { useState, useEffect } from 'react';
import { HelpCircle, ChevronDown, ChevronUp, Send, Keyboard, Activity, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

const FAQS = [
  { q: 'How do I see my pending approvals?', a: 'Your personal action queue is the "My Actions" tab (home screen). It shows only items currently awaiting your approval or task completion — nothing else.' },
  { q: 'What are the three main tabs?', a: '"My Actions" shows what needs your action now. "Completed" shows workflows you participated in that are fully approved. "Pending With" shows in-flight workflows you are involved in, wherever they currently sit.' },
  { q: 'How do I approve or reject a submission?', a: 'Click "Review & Approve" on any card in My Actions. The approval modal will open where you can add a comment, capture a signature, and submit your decision.' },
  { q: 'How do I export data?', a: 'Use the Export button on any dashboard page. You can export the current filtered view as an Excel file.' },
  { q: 'How does role-based access work?', a: 'There are four roles: Super Admin (full access), Admin (manage team and settings), Approver (workflow actions), and Viewer (read-only). Your role is set by your organisation administrator.' },
  { q: 'Why do I see a blank dashboard?', a: 'The dashboard only shows workflows where YOU have an active task. If nothing is pending on your step, the queue will be empty. Check "Pending With" to see all workflows you are involved in.' },
  { q: 'How do I sync the latest data from JotForm?', a: 'Go to Settings → Sync tab → click "Sync All Submissions". This pulls the latest state from JotForm Enterprise and updates all workflow statuses in real time.' },
  { q: 'Is my data secure?', a: 'Yes. All data is stored in a self-hosted PostgreSQL database behind the government network. Access is gated by JotForm workspace membership verification on every login. All connections use HTTPS.' },
];

const SHORTCUTS = [
  { keys: ['Esc'], desc: 'Close any open modal or sidebar' },
  { keys: ['Tab'], desc: 'Navigate between interactive elements' },
  { keys: ['Enter'], desc: 'Submit focused form or confirm action' },
];

type ServiceStatus = 'operational' | 'degraded' | 'down' | 'checking';

interface ServiceCheck {
  name: string;
  status: ServiceStatus;
}

export default function HelpSupport() {
  const { user } = useAuth();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'faq' | 'shortcuts' | 'status' | 'contact'>('faq');
  const [contactForm, setContactForm] = useState({
    name: user?.fullName || '',
    email: user?.email || '',
    message: '',
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState('');

  const [services, setServices] = useState<ServiceCheck[]>([
    { name: 'Backend API', status: 'checking' },
    { name: 'Database', status: 'checking' },
    { name: 'JotForm Connection', status: 'checking' },
  ]);

  useEffect(() => {
    if (activeTab !== 'status') return;
    let cancelled = false;

    const check = async () => {
      try {
        const health = await apiFetch<{ ok?: boolean; db?: string; jotform?: string }>(
          '/api/health/ready',
          { throwOnError: false }
        );
        if (cancelled) return;
        setServices([
          { name: 'Backend API', status: 'operational' },
          { name: 'Database', status: (health?.db === 'ok' || health?.ok) ? 'operational' : 'degraded' },
          { name: 'JotForm Connection', status: health?.jotform === 'ok' ? 'operational' : health?.jotform === 'error' ? 'degraded' : 'operational' },
        ]);
      } catch {
        if (cancelled) return;
        setServices([
          { name: 'Backend API', status: 'down' },
          { name: 'Database', status: 'down' },
          { name: 'JotForm Connection', status: 'down' },
        ]);
      }
    };
    check();
    return () => { cancelled = true; };
  }, [activeTab]);

  const handleContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setSendError('');
    try {
      await apiFetch('/api/support-message', {
        method: 'POST',
        body: JSON.stringify(contactForm),
      });
      setSent(true);
      setContactForm(f => ({ ...f, message: '' }));
    } catch {
      setSendError('Could not send your message. Please try again or email admin@bettroi.com directly.');
    } finally {
      setSending(false);
    }
  };

  const allOperational = services.every(s => s.status === 'operational');

  const tabs = [
    { id: 'faq' as const, label: 'FAQ', icon: HelpCircle },
    { id: 'shortcuts' as const, label: 'Shortcuts', icon: Keyboard },
    { id: 'status' as const, label: 'API Status', icon: Activity },
    { id: 'contact' as const, label: 'Contact', icon: Send },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <HelpCircle className="w-7 h-7 text-gold" /> Help & Support
        </h1>
        <p className="text-gray-400 mt-1">Find answers, shortcuts, and get help</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${activeTab === t.id ? 'bg-gold/10 text-gold border border-gold/20' : 'text-gray-400 hover:text-white'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'faq' && (
        <div className="space-y-3">
          {FAQS.map((faq, i) => (
            <div key={i} className="glass-card overflow-hidden">
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between p-5 text-left cursor-pointer">
                <span className="text-white font-medium">{faq.q}</span>
                {openFaq === i ? <ChevronUp className="w-5 h-5 text-gold flex-shrink-0" /> : <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />}
              </button>
              {openFaq === i && (
                <div className="px-5 pb-5 text-gray-300 border-t border-navy-light/20 pt-4 leading-relaxed">{faq.a}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'shortcuts' && (
        <div className="glass-card p-6">
          <p className="text-gray-400 text-sm mb-4">Universal keyboard shortcuts — work on all pages.</p>
          <div className="grid gap-4">
            {SHORTCUTS.map(s => (
              <div key={s.desc} className="flex items-center justify-between">
                <span className="text-gray-300">{s.desc}</span>
                <div className="flex gap-1">
                  {s.keys.map(k => (
                    <kbd key={k} className="px-2 py-1 rounded-lg bg-navy-dark border border-navy-light/30 text-sm text-gray-300 font-mono">{k}</kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'status' && (
        <div className="glass-card p-6 space-y-4">
          <div className={`flex items-center gap-2 mb-4 ${allOperational ? 'text-emerald-400' : 'text-amber-400'}`}>
            {allOperational
              ? <><CheckCircle className="w-5 h-5" /><span className="font-medium">All Systems Operational</span></>
              : <><Activity className="w-5 h-5 animate-pulse" /><span className="font-medium">Checking system status…</span></>
            }
          </div>
          {services.map(s => (
            <div key={s.name} className="flex items-center justify-between py-3 border-b border-navy-light/10 last:border-0">
              <span className="text-white">{s.name}</span>
              <div className="flex items-center gap-2">
                {s.status === 'checking' && <><Loader2 className="w-4 h-4 text-gray-400 animate-spin" /><span className="text-sm text-gray-400">Checking…</span></>}
                {s.status === 'operational' && <><CheckCircle className="w-4 h-4 text-emerald-400" /><span className="text-sm text-emerald-400">Operational</span></>}
                {s.status === 'degraded' && <><Activity className="w-4 h-4 text-amber-400" /><span className="text-sm text-amber-400">Degraded</span></>}
                {s.status === 'down' && <><XCircle className="w-4 h-4 text-red-400" /><span className="text-sm text-red-400">Down</span></>}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'contact' && (
        <div className="glass-card p-8 max-w-lg">
          {sent ? (
            <div className="text-center py-8">
              <CheckCircle className="w-12 h-12 text-gold mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white">Message Sent!</h3>
              <p className="text-gray-400 mt-1">We'll get back to you within 24 hours.</p>
              <button onClick={() => setSent(false)} className="mt-4 text-sm text-gold hover:underline cursor-pointer">Send another message</button>
            </div>
          ) : (
            <form onSubmit={handleContact} className="space-y-4">
              {sendError && (
                <div className="flex items-start gap-2 bg-red-900/30 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">
                  <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{sendError}
                </div>
              )}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <input type="text" required value={contactForm.name} onChange={e => setContactForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-navy-dark border border-navy-light/30 text-white focus:border-gold/50 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Email</label>
                <input type="email" required value={contactForm.email} onChange={e => setContactForm(p => ({ ...p, email: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-navy-dark border border-navy-light/30 text-white focus:border-gold/50 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Message</label>
                <textarea required rows={4} value={contactForm.message} onChange={e => setContactForm(p => ({ ...p, message: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-navy-dark border border-navy-light/30 text-white focus:border-gold/50 focus:outline-none resize-none" />
              </div>
              <button type="submit" disabled={sending} className="btn-gold flex items-center gap-2 cursor-pointer disabled:opacity-50">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sending ? 'Sending…' : 'Send Message'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
