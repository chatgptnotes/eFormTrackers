import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, ArrowRight, Loader2, Eye, EyeOff, AlertCircle, ShieldCheck, BookOpen } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { humanizeError } from '../lib/errors';

export default function Login() {
  const { signIn, signInWithMicrosoft } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msLoading, setMsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    // Handle OAuth error redirects from query params
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error');
    if (oauthError === 'microsoft_auth_failed') {
      setError('Microsoft sign-in failed. Please try again or use email and password.');
    } else if (oauthError === 'microsoft_no_email') {
      setError('Could not retrieve your email from Microsoft. Please use email and password.');
    } else if (oauthError === 'microsoft_not_configured') {
      setError('Microsoft sign-in is not configured. Please use email and password.');
    }
    if (oauthError) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    // Handle session-based rejections
    const rejection = sessionStorage.getItem('auth_rejection');
    const rejectedEmail = sessionStorage.getItem('auth_rejection_email');
    if (rejection === 'not_workspace_member') {
      setError(
        `Access denied. ${rejectedEmail ? `"${rejectedEmail}" is` : 'Your account is'} not a member of the GDMO - Bettroi workspace. Contact admin@bettroi.com to request access.`
      );
    } else if (rejection === 'verification_error') {
      setError('Could not verify workspace membership. Please try again or contact admin@bettroi.com.');
    } else if (rejection === 'idle_timeout') {
      setError('You have been signed out due to 30 minutes of inactivity. Please sign in again.');
    }
    sessionStorage.removeItem('auth_rejection');
    sessionStorage.removeItem('auth_rejection_email');
  }, []);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: err } = await signIn(email, password);
    if (err) {
      setError(humanizeError(err, 'Sign in failed. Please check your details and try again.'));
      setLoading(false);
    } else {
      navigate('/app');
    }
  };

  const handleMicrosoft = () => {
    setMsLoading(true);
    setError(null);
    window.location.href = '/api/auth/microsoft';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50 flex items-center justify-center p-4 overflow-hidden relative">
      <div className="absolute top-20 -left-20 w-72 h-72 bg-blue-200/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-20 -right-20 w-72 h-72 bg-purple-200/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-10">
          <Link to="/" className="inline-flex items-center justify-center gap-2 mb-8">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-blue-400 to-purple-500 p-2 shadow-xl">
              <img src="https://eforms.mediaoffice.ae/enterprise/logo.png" alt="FlowAccel Logo" className="w-full h-full object-contain" />
            </div>
            <span className="text-3xl font-black bg-gradient-to-r from-blue-600 via-purple-600 to-blue-500 bg-clip-text text-transparent">FlowAccel</span>
          </Link>
          <h1 className="text-4xl md:text-5xl font-black text-slate-900 mb-2">Welcome back</h1>
          <p className="text-slate-600 text-base font-semibold">Sign in to continue</p>
        </div>

        <div className="backdrop-blur-2xl bg-white/80 border border-white/50 rounded-3xl p-8 shadow-2xl">
          {error && (
            <div className="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-2xl">
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0 text-red-600" />
              <p className="text-sm font-medium leading-relaxed">{error}</p>
            </div>
          )}

          <button
            onClick={handleMicrosoft}
            disabled={msLoading || loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-2xl bg-white border-2 border-slate-300 text-slate-900 hover:border-blue-500 hover:bg-blue-50 hover:shadow-lg transition-all font-bold text-base disabled:opacity-50 disabled:cursor-not-allowed mb-6"
          >
            {msLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 21 21">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
            )}
            {msLoading ? 'Signing in...' : 'Sign in with Microsoft'}
          </button>

          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
            <span className="text-xs text-slate-500 uppercase tracking-widest font-semibold">or</span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-slate-800 mb-2.5 tracking-wide">Email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-slate-50 border border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none transition-all duration-300 font-medium"
                  placeholder="you@company.com"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-800 mb-2.5 tracking-wide">Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-3.5 rounded-2xl bg-slate-50 border border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none transition-all duration-300 font-medium"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-blue-500 transition-colors duration-300"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || msLoading}
              className="w-full py-3.5 mt-2 flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-bold rounded-2xl hover:shadow-lg hover:shadow-blue-500/40 hover:-translate-y-0.5 transition-all duration-300 disabled:opacity-50 disabled:hover:translate-y-0 text-base"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Sign In <ArrowRight className="w-5 h-5" /></>}
            </button>
          </form>

          <div className="mt-6 flex items-start gap-2 text-xs text-slate-500 leading-relaxed border-t border-slate-200 pt-4">
            <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600" />
            <p>
              Access restricted to <span className="font-semibold text-slate-700">GDMO - Bettroi</span> workspace members. Both sign-in methods verify your JotForm workspace membership.
            </p>
          </div>
        </div>

        <p className="text-center text-slate-500 mt-6 text-xs">
          Need access? Contact <a href="mailto:admin@bettroi.com" className="text-blue-600 hover:text-blue-700 font-semibold">admin@bettroi.com</a>
        </p>

        <a
          href="/installer/FlowAccel-Manual-IIS-Deployment.html"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 w-full flex items-center justify-center gap-3 px-4 py-3 rounded-2xl bg-white/70 backdrop-blur border border-slate-300 text-slate-800 hover:border-indigo-500 hover:bg-white hover:shadow-md transition-all font-semibold text-sm"
        >
          <BookOpen className="w-4 h-4 text-indigo-600" />
          Manual IIS Deployment Guide
        </a>
        <p className="text-center text-slate-400 mt-2 text-[11px]">
          Enable IIS · Default Web Site → 8081, FlowAccel → 80 · copy files to E:\ · grant IIS user permissions · load PostgreSQL dump.
        </p>
        <p className="text-center text-slate-400 mt-1 text-[10px] italic">
          IIS v1.1 · Updated 2026-05-21 12:43 IST
        </p>
      </div>
    </div>
  );
}
