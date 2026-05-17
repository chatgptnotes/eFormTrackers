import { useState } from 'react';
import { HelpCircle, ChevronDown, ChevronUp, Send, Keyboard, Activity, CheckCircle, XCircle } from 'lucide-react';

const FAQS = [
  { q: 'How do I connect my JotForm account?', a: 'Go to Settings → API Configuration, enter your JotForm API key. You can generate one from JotForm\'s Settings → API → Create New Key.' },
  { q: 'What are the approval levels?', a: 'Approval levels represent stages in your workflow. Each submission passes through levels (e.g., Department Head → Division Manager → Director → CEO).' },
  { q: 'How do I export reports?', a: 'Click the Export button on any dashboard page. You can export as Excel, PDF, or CSV. Business and Enterprise plans support all formats.' },
  { q: 'Can I customize SLA thresholds?', a: 'Yes! Go to Settings → SLA Configuration to set custom day limits for each approval level. The system will track and alert on breaches.' },
  { q: 'How does role-based access work?', a: 'There are 4 roles: Super Admin (full access), Admin (manage forms/dashboards), Approver (pending approvals only), Viewer (read-only).' },
  { q: 'Is my data secure?', a: 'Yes. We use Supabase with Row Level Security, ensuring each organization can only access its own data. All connections are encrypted.' },
];

const SHORTCUTS = [
  { keys: ['⌘', 'K'], desc: 'Quick search' },
  { keys: ['⌘', '/'], desc: 'Keyboard shortcuts' },
  { keys: ['⌘', 'D'], desc: 'Go to Dashboard' },
  { keys: ['⌘', 'T'], desc: 'Go to Tracker' },
  { keys: ['⌘', 'B'], desc: 'Go to Bottlenecks' },
  { keys: ['⌘', 'E'], desc: 'Export current view' },
];

const API_STATUS = [
  { name: 'JotForm API', status: 'operational' as const },
  { name: 'Supabase Auth', status: 'operational' as const },
  { name: 'Supabase Database', status: 'operational' as const },
  { name: 'Export Service', status: 'operational' as const },
];

export default function HelpSupport() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'faq' | 'shortcuts' | 'status' | 'contact'>('faq');
  const [contactForm, setContactForm] = useState({ name: '', email: '', message: '' });
  const [sent, setSent] = useState(false);

  const handleContact = (e: React.FormEvent) => {
    e.preventDefault();
    setSent(true);
    setTimeout(() => setSent(false), 5000);
    setContactForm({ name: '', email: '', message: '' });
  };

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

      <div className="flex gap-2">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeTab === t.id ? 'bg-gold/10 text-gold border border-gold/20' : 'text-gray-400 hover:text-white'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'faq' && (
        <div className="space-y-3">
          {FAQS.map((faq, i) => (
            <div key={i} className="glass-card overflow-hidden">
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between p-5 text-left">
                <span className="text-white font-medium">{faq.q}</span>
                {openFaq === i ? <ChevronUp className="w-5 h-5 text-gold" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
              </button>
              {openFaq === i && (
                <div className="px-5 pb-5 text-gray-400 border-t border-navy-light/20 pt-4">{faq.a}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'shortcuts' && (
        <div className="glass-card p-6">
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
          <div className="flex items-center gap-2 text-emerald-400 mb-4">
            <CheckCircle className="w-5 h-5" />
            <span className="font-medium">All Systems Operational</span>
          </div>
          {API_STATUS.map(s => (
            <div key={s.name} className="flex items-center justify-between py-3 border-b border-navy-light/10 last:border-0">
              <span className="text-white">{s.name}</span>
              <div className="flex items-center gap-2">
                {s.status === 'operational' ? (
                  <><CheckCircle className="w-4 h-4 text-emerald-400" /><span className="text-sm text-emerald-400">Operational</span></>
                ) : (
                  <><XCircle className="w-4 h-4 text-red-400" /><span className="text-sm text-red-400">Down</span></>
                )}
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
            </div>
          ) : (
            <form onSubmit={handleContact} className="space-y-4">
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
              <button type="submit" className="btn-gold flex items-center gap-2">
                <Send className="w-5 h-5" /> Send Message
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
