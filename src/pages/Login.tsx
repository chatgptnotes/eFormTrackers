import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { signInWithMicrosoft } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const rejection = sessionStorage.getItem('auth_rejection');
    const rejectedEmail = sessionStorage.getItem('auth_rejection_email');
    if (rejection === 'not_workspace_member') {
      setError(
        `Access denied. ${rejectedEmail ? `"${rejectedEmail}" is` : 'Your account is'} not a member of the GDMO - Bettroi workspace. Contact admin@bettroi.com to request access.`
      );
    } else if (rejection === 'verification_error') {
      setError('Could not verify workspace membership. Please try again or contact admin@bettroi.com.');
    }
    sessionStorage.removeItem('auth_rejection');
    sessionStorage.removeItem('auth_rejection_email');
  }, []);

  const handleMicrosoft = async () => {
    setLoading(true);
    setError(null);
    const { error: err } = await signInWithMicrosoft();
    if (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50 flex items-center justify-center p-4 overflow-hidden relative">
      <div className="absolute top-20 -left-20 w-72 h-72 bg-blue-200/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-20 -right-20 w-72 h-72 bg-purple-200/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-12">
          <Link to="/" className="inline-flex items-center justify-center gap-2 mb-8">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-blue-400 to-purple-500 p-2 shadow-xl">
              <img src="https://eforms.mediaoffice.ae/enterprise/logo.png" alt="FlowAccel Logo" className="w-full h-full object-contain" />
            </div>
            <span className="text-3xl font-black bg-gradient-to-r from-blue-600 via-purple-600 to-blue-500 bg-clip-text text-transparent">FlowAccel</span>
          </Link>
          <h1 className="text-4xl md:text-5xl font-black text-slate-900 mb-2">Welcome back</h1>
          <p className="text-slate-600 text-lg font-semibold">Sign in with your Microsoft account</p>
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
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-4 rounded-2xl bg-white border-2 border-slate-300 text-slate-900 hover:border-blue-500 hover:bg-blue-50 hover:shadow-lg hover:-translate-y-0.5 transition-all font-bold text-base disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 21 21">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
            )}
            {loading ? 'Signing in...' : 'Sign in with Microsoft'}
          </button>

          <div className="mt-6 flex items-start gap-2 text-xs text-slate-500 leading-relaxed">
            <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600" />
            <p>
              Access restricted to <span className="font-semibold text-slate-700">GDMO - Bettroi</span> workspace members. Your Microsoft email must match an active member of this JotForm workspace.
            </p>
          </div>
        </div>

        <p className="text-center text-slate-500 mt-8 text-xs">
          Need access? Contact <a href="mailto:admin@bettroi.com" className="text-blue-600 hover:text-blue-700 font-semibold">admin@bettroi.com</a>
        </p>
      </div>
    </div>
  );
}
