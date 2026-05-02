import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, ArrowRight, Loader2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { signIn, signInWithMagicLink, signInWithMicrosoft } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'password' | 'magic'>('password');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [magicSent, setMagicSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    if (mode === 'magic') {
      const { error: err } = await signInWithMagicLink(email);
      if (err) setError(String(err));
      else setMagicSent(true);
    } else {
      const { error: err } = await signIn(email, password);
      if (err) setError(String(err));
      else navigate('/app');
    }
    setLoading(false);
  };

  const handleMicrosoft = async () => {
    setLoading(true);
    const { error: err } = await signInWithMicrosoft();
    if (err) setError(String(err));
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50 flex items-center justify-center p-4 overflow-hidden relative">
      {/* Animated background orbs */}
      <div className="absolute top-20 -left-20 w-72 h-72 bg-blue-200/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-20 -right-20 w-72 h-72 bg-purple-200/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />

      <div className="w-full max-w-md relative z-10">
        {/* Header */}
        <div className="text-center mb-12">
          <Link to="/" className="inline-flex items-center justify-center gap-2 mb-8">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-blue-400 to-purple-500 p-2 shadow-xl">
              <img src="https://eforms.mediaoffice.ae/enterprise/logo.png" alt="FlowAccel Logo" className="w-full h-full object-contain" />
            </div>
            <span className="text-3xl font-black bg-gradient-to-r from-blue-600 via-purple-600 to-blue-500 bg-clip-text text-transparent">FlowAccel</span>
          </Link>
          <h1 className="text-4xl md:text-5xl font-black text-slate-900 mb-2">Welcome back</h1>
          <p className="text-slate-600 text-lg font-semibold">Let's get things done</p>
        </div>

        {/* Card */}
        <div className="backdrop-blur-2xl bg-white/80 border border-white/50 rounded-3xl p-8 shadow-2xl hover:shadow-2xl transition-shadow duration-300">
          {magicSent ? (
            <div className="text-center py-8">
              <Mail className="w-12 h-12 text-gold mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">Check your email</h3>
              <p className="text-gray-400">We sent a magic link to <strong className="text-white">{email}</strong></p>
            </div>
          ) : (
            <>
              <button onClick={handleMicrosoft} disabled={loading}
                className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-2xl border border-slate-300 text-slate-800 hover:border-blue-500/50 hover:bg-blue-50 transition-all mb-6 font-semibold">
                <svg className="w-5 h-5" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
                Sign in with Microsoft
              </button>

              <div className="flex items-center gap-4 mb-6">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
                <span className="text-xs text-slate-500 uppercase tracking-widest font-semibold">or</span>
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
              </div>

              <div className="flex gap-3 mb-6 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
                <button onClick={() => setMode('password')} className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all duration-300 ${mode === 'password' ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-lg shadow-blue-500/30' : 'text-slate-600 hover:text-slate-900'}`}>Password</button>
                <button onClick={() => setMode('magic')} className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all duration-300 ${mode === 'magic' ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-lg shadow-blue-500/30' : 'text-slate-600 hover:text-slate-900'}`}>Magic Link</button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-bold text-slate-800 mb-2.5 tracking-wide">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500" />
                    <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                      className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-slate-50 border border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none transition-all duration-300 font-medium"
                      placeholder="you@company.com" />
                  </div>
                </div>
                {mode === 'password' && (
                  <div>
                    <label className="block text-sm font-bold text-slate-800 mb-2.5 tracking-wide">Password</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500" />
                      <input type={showPassword ? "text" : "password"} required value={password} onChange={e => setPassword(e.target.value)}
                        className="w-full pl-12 pr-12 py-3.5 rounded-2xl bg-slate-50 border border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none transition-all duration-300 font-medium"
                        placeholder="••••••••" />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-blue-500 transition-colors duration-300"
                      >
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                    <div className="mt-3 text-right">
                      <Link to="/forgot-password" className="text-sm text-blue-600 hover:text-blue-700 transition-colors font-semibold">Forgot password?</Link>
                    </div>
                  </div>
                )}
                {error && <p className="text-red-600 text-sm font-semibold bg-red-100 px-4 py-2.5 rounded-xl border border-red-300">{error}</p>}
                <button type="submit" disabled={loading}
                  className="w-full py-3.5 mt-8 flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-bold rounded-2xl hover:shadow-lg hover:shadow-blue-500/40 hover:-translate-y-0.5 transition-all duration-300 disabled:opacity-50 text-lg">
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Sign In <ArrowRight className="w-5 h-5" /></>}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-slate-700 mt-8 text-lg">
          New here? <Link to="/signup" className="text-transparent bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text font-bold hover:from-blue-700 hover:to-purple-700 transition-all duration-300">Create account</Link>
        </p>
      </div>
    </div>
  );
}
