import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, Loader2, AlertCircle, CheckCircle, Copy, Check } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { humanizeError } from '../lib/errors';
import { JOTFORM_LOGO_URL } from '../config/jotform';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetUrl, setResetUrl] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{ ok: boolean; resetUrl?: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setSent(true);
      if (res?.resetUrl) setResetUrl(window.location.origin + res.resetUrl);
    } catch (err) {
      setError(humanizeError(err, 'Could not generate the reset link. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(resetUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="app-page bg-gradient-to-br from-slate-50 via-blue-50 to-sky-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center justify-center gap-2 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-sky-500 p-2 shadow-xl flex items-center justify-center">
              <img src={JOTFORM_LOGO_URL} alt="Logo" className="w-full h-full object-contain" />
            </div>
            <span className="text-2xl font-black text-slate-900">eForm<span className="text-blue-600">Tracker</span></span>
          </Link>
          <h1 className="text-3xl font-black text-slate-900">Reset Password</h1>
          <p className="text-slate-600 mt-1">Enter your email to generate a reset link</p>
        </div>

        <div className="backdrop-blur-xl bg-white/80 border border-white/50 rounded-3xl p-5 sm:p-8 shadow-2xl">
          {sent ? (
            <div className="text-center py-4 space-y-4">
              <CheckCircle className="w-14 h-14 text-emerald-500 mx-auto" />
              <div>
                <h3 className="text-lg font-bold text-slate-900">Reset Link Generated</h3>
                <p className="text-slate-600 text-sm mt-1">
                  {resetUrl
                    ? 'Copy the link below and share it with the user.'
                    : 'Contact your IT administrator — the reset link has been logged on the server.'}
                </p>
              </div>
              {resetUrl && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-left">
                  <p className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">Reset Link</p>
                  <p className="text-xs text-slate-700 break-all font-mono">{resetUrl}</p>
                  <button
                    onClick={copyLink}
                    className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-semibold cursor-pointer"
                  >
                    {copied ? <><Check className="w-3.5 h-3.5" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy link</>}
                  </button>
                </div>
              )}
              <button onClick={() => { setSent(false); setEmail(''); setResetUrl(''); }} className="text-sm text-blue-600 hover:underline cursor-pointer">
                Generate another link
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-2xl">
                  <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0 text-red-600" />
                  <p className="text-sm font-medium">{error}</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-2.5 tracking-wide">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500" />
                  <input
                    type="email" required value={email} onChange={e => setEmail(e.target.value)}
                    className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-slate-50 border border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
                    placeholder="you@example.com"
                  />
                </div>
              </div>
              <button
                type="submit" disabled={loading}
                className="w-full py-3.5 flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-bold rounded-2xl hover:shadow-lg transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Generate Reset Link'}
              </button>
            </form>
          )}
        </div>

        <div className="text-center mt-6">
          <Link to="/login" className="text-blue-600 hover:text-blue-700 font-semibold inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
