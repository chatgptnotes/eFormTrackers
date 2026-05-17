import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Key, ListChecks, GitBranch, LayoutDashboard, ArrowRight, ArrowLeft, SkipForward, CheckCircle, Loader2 } from 'lucide-react';

const STEPS = [
  { icon: Key, title: 'Connect JotForm', desc: 'Enter your JotForm API key to import forms.' },
  { icon: ListChecks, title: 'Select Forms', desc: 'Choose which forms to track in the dashboard.' },
  { icon: GitBranch, title: 'Map Approval Levels', desc: 'Define approval workflow stages for your forms.' },
  { icon: LayoutDashboard, title: 'Your Dashboard', desc: 'Everything is set up. View your dashboard!' },
];

const DEMO_FORMS = [
  { id: 'f1', title: 'Leave Request Form', submissions: 45 },
  { id: 'f2', title: 'Procurement Approval', submissions: 128 },
  { id: 'f3', title: 'IT Service Request', submissions: 67 },
  { id: 'f4', title: 'Travel Authorization', submissions: 23 },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [selectedForms, setSelectedForms] = useState<string[]>([]);
  const [levels, setLevels] = useState(4);
  const [connecting, setConnecting] = useState(false);

  const handleConnect = () => {
    setConnecting(true);
    setTimeout(() => { setConnecting(false); setStep(1); }, 1500);
  };

  const toggleForm = (id: string) => {
    setSelectedForms(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  };

  return (
    <div className="min-h-screen bg-navy-dark flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Progress */}
        <div className="flex items-center justify-between mb-12">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${i <= step ? 'gold-gradient text-navy-dark' : 'bg-navy-light/30 text-gray-500'}`}>
                {i < step ? <CheckCircle className="w-5 h-5" /> : <s.icon className="w-5 h-5" />}
              </div>
              {i < STEPS.length - 1 && <div className={`w-16 md:w-24 h-0.5 mx-2 ${i < step ? 'bg-gold' : 'bg-navy-light/30'}`} />}
            </div>
          ))}
        </div>

        <div className="glass-card p-8">
          <h2 className="text-2xl font-bold text-white mb-2">{STEPS[step].title}</h2>
          <p className="text-gray-400 mb-8">{STEPS[step].desc}</p>

          {/* Step 0: API Key */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">JotForm API Key</label>
                <input type="text" value={apiKey} onChange={e => setApiKey(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-navy-dark border border-navy-light/30 text-white placeholder-gray-500 focus:border-gold/50 focus:outline-none"
                  placeholder="Enter your API key..." />
                <p className="text-xs text-gray-500 mt-2">Find it at JotForm → Settings → API → Create New Key</p>
              </div>
              <button onClick={handleConnect} disabled={!apiKey || connecting} className="btn-gold flex items-center gap-2">
                {connecting ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Connect <ArrowRight className="w-5 h-5" /></>}
              </button>
            </div>
          )}

          {/* Step 1: Select Forms */}
          {step === 1 && (
            <div className="space-y-3">
              {DEMO_FORMS.map(f => (
                <button key={f.id} onClick={() => toggleForm(f.id)}
                  className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${selectedForms.includes(f.id) ? 'border-gold/50 bg-gold/5' : 'border-navy-light/30 hover:border-gold/20'}`}>
                  <div className="text-left">
                    <div className="text-white font-medium">{f.title}</div>
                    <div className="text-sm text-gray-400">{f.submissions} submissions</div>
                  </div>
                  {selectedForms.includes(f.id) && <CheckCircle className="w-5 h-5 text-gold" />}
                </button>
              ))}
            </div>
          )}

          {/* Step 2: Map Levels */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Number of Approval Levels</label>
                <div className="flex gap-3">
                  {[2, 3, 4, 5].map(n => (
                    <button key={n} onClick={() => setLevels(n)}
                      className={`px-6 py-3 rounded-xl font-semibold transition-all ${levels === n ? 'gold-gradient text-navy-dark' : 'border border-navy-light/30 text-gray-400 hover:border-gold/30'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2 mt-6">
                {Array.from({ length: levels }, (_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-navy-dark border border-navy-light/20">
                    <div className="w-8 h-8 rounded-full gold-gradient flex items-center justify-center text-navy-dark font-bold text-sm">{i + 1}</div>
                    <input type="text" defaultValue={['Department Head', 'Division Manager', 'Director', 'CEO', 'Board'][i]}
                      className="flex-1 bg-transparent text-white focus:outline-none" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Done */}
          {step === 3 && (
            <div className="text-center py-8">
              <div className="w-20 h-20 rounded-full gold-gradient flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="w-10 h-10 text-navy-dark" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">You're All Set!</h3>
              <p className="text-gray-400 mb-8">Your dashboard is ready. Start tracking approvals now.</p>
              <button onClick={() => navigate('/app')} className="btn-gold text-lg px-8 py-3 flex items-center gap-2 mx-auto">
                Go to Dashboard <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* Navigation */}
          {step < 3 && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-navy-light/20">
              <div className="flex gap-3">
                {step > 0 && (
                  <button onClick={() => setStep(step - 1)} className="btn-outline flex items-center gap-2">
                    <ArrowLeft className="w-4 h-4" /> Back
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => navigate('/app')} className="text-gray-400 hover:text-white flex items-center gap-1 transition-colors">
                  <SkipForward className="w-4 h-4" /> Skip
                </button>
                {step > 0 && (
                  <button onClick={() => setStep(step + 1)} className="btn-gold flex items-center gap-2">
                    Next <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
