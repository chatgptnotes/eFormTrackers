import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, ArrowRight, Loader2, Eye, EyeOff, AlertCircle, ShieldCheck, Building2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { humanizeError } from '../lib/errors';
import workflowIllustration from '../assets/workflow-login-illustration.png';

export default function Login({ adminMode = false }: { adminMode?: boolean }) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msLoading, setMsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error');
    const oauthMessages: Record<string, string> = {
      microsoft_auth_failed: 'Microsoft sign-in failed. Please try again or use email and password.',
      microsoft_no_email: 'Could not retrieve your email from Microsoft. Please use email and password.',
      microsoft_not_configured: 'Microsoft sign-in is not configured. Please use email and password.',
      not_workspace_member: 'Access denied. Your Microsoft account is not a member of the GDMO – Bettroi workspace.',
      workspace_check_failed: 'Could not verify your workspace membership. Please try again.',
    };
    if (oauthError) {
      setError(oauthMessages[oauthError] || 'Sign-in failed. Please try again.');
      window.history.replaceState({}, '', window.location.pathname);
    }
    const rejection = sessionStorage.getItem('auth_rejection');
    const rejectedEmail = sessionStorage.getItem('auth_rejection_email');
    if (rejection === 'not_workspace_member') setError(`Access denied. ${rejectedEmail ? `“${rejectedEmail}” is` : 'Your account is'} not a workspace member.`);
    if (rejection === 'verification_error') setError('Could not verify workspace membership. Please try again.');
    if (rejection === 'idle_timeout') setError('You have been signed out after 30 minutes of inactivity.');
    sessionStorage.removeItem('auth_rejection');
    sessionStorage.removeItem('auth_rejection_email');
  }, []);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: err } = await signIn(email, password, adminMode);
    if (err) {
      setError(humanizeError(err, 'Sign in failed. Please check your details and try again.'));
      setLoading(false);
    } else navigate('/app');
  };

  const handleMicrosoft = () => {
    setMsLoading(true);
    setError(null);
    window.location.href = '/api/auth/microsoft';
  };

  return (
    <main className="min-h-dvh bg-slate-100 p-3 sm:p-6 lg:p-8">
      <div className="mx-auto grid min-h-[calc(100dvh-1.5rem)] max-w-[1440px] overflow-hidden rounded-[2rem] bg-white shadow-2xl shadow-slate-900/10 sm:min-h-[calc(100dvh-3rem)] lg:grid-cols-[1.05fr_.95fr]">
        <section className="auth-hero relative hidden overflow-hidden bg-slate-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <img src={workflowIllustration} alt="" className="absolute inset-0 h-full w-full object-cover object-center opacity-80" />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/90 to-slate-950/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-slate-950/25" />
          <Link to="/" className="relative inline-flex items-center gap-3 self-start">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-600 text-sm font-black shadow-lg shadow-blue-500/30">ET</span>
            <span className="text-lg font-bold tracking-tight">eForm<span className="text-cyan-300">Tracker</span></span>
          </Link>
          <div className="relative max-w-lg">
            <p className="mb-5 text-xs font-bold uppercase tracking-[.22em] text-cyan-300">Workflow operations</p>
            <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight">Move every approval forward with confidence.</h1>
            <p className="mt-6 max-w-md text-base leading-7 text-slate-300">One secure workspace for assigned forms, approvals, audit history, and workflow visibility.</p>
            <ul className="mt-10 space-y-4 text-sm text-slate-200">
              {['Review only the work assigned to you', 'Sign approvals once, with a complete audit trail', 'Open secure pre-filled task forms directly'].map(item => <li key={item} className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 text-cyan-300" />{item}</li>)}
            </ul>
          </div>
          <div className="relative flex items-center gap-3 border-t border-white/10 pt-6 text-xs text-slate-400"><ShieldCheck className="h-4 w-4 text-cyan-300" />GDMO – Bettroi secure workspace</div>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-10 lg:p-16">
          <div className="w-full max-w-md">
            <Link to="/" className="mb-12 inline-flex items-center gap-3 lg:hidden">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-xs font-black text-white">ET</span>
              <span className="text-lg font-bold tracking-tight text-slate-950">eForm<span className="text-blue-600">Tracker</span></span>
            </Link>
            <div className="mb-8">
              <span className="mb-5 grid h-11 w-11 place-items-center rounded-xl bg-blue-50 text-blue-600"><Building2 className="h-5 w-5" /></span>
              <p className="text-xs font-bold uppercase tracking-[.18em] text-blue-600">Secure sign in</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{adminMode ? 'Administrator access' : 'Welcome back'}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">{adminMode ? 'Sign in with your administrator account.' : 'Use your workspace account to continue.'}</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              {error && <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800"><AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" /><p className="text-sm font-medium leading-relaxed">{error}</p></div>}
              {!adminMode && <button onClick={handleMicrosoft} disabled={msLoading || loading} className="auth-microsoft mb-6 flex w-full items-center justify-center gap-3 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                {msLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <svg className="h-5 w-5" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022" /><rect x="11" y="1" width="9" height="9" fill="#7fba00" /><rect x="1" y="11" width="9" height="9" fill="#00a4ef" /><rect x="11" y="11" width="9" height="9" fill="#ffb900" /></svg>}
                {msLoading ? 'Signing in…' : 'Continue with Microsoft'}
              </button>}
              {!adminMode && <div className="mb-6 flex items-center gap-3"><div className="h-px flex-1 bg-slate-200" /><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">or email</span><div className="h-px flex-1 bg-slate-200" /></div>}
              <form onSubmit={handlePasswordSubmit} className="space-y-5">
                <div><label className="mb-2 block text-sm font-semibold text-slate-700">Email address</label><div className="relative"><Mail className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-blue-500" /><input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 font-medium text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10" placeholder="you@company.com" /></div></div>
                <div><label className="mb-2 block text-sm font-semibold text-slate-700">Password</label><div className="relative"><Lock className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-blue-500" /><input type={showPassword ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-12 font-medium text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10" placeholder="••••••••" /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600">{showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button></div></div>
                <button type="submit" disabled={loading || msLoading} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-500/20 disabled:opacity-50">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Sign in <ArrowRight className="h-4 w-4" /></>}</button>
              </form>
              <div className="mt-6 flex items-start gap-2 border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-500"><ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" /><p>Access is restricted to GDMO – Bettroi workspace members.</p></div>
            </div>
            <p className="mt-6 text-center text-xs text-slate-500">Need access? Contact <a href="mailto:admin@bettroi.com" className="font-semibold text-blue-600 hover:text-blue-700">admin@bettroi.com</a></p>
          </div>
        </section>
      </div>
    </main>
  );
}
