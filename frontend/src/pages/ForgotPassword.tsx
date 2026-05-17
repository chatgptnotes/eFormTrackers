import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Zap, Mail, ArrowLeft, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function ForgotPassword() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error: err } = await resetPassword(email);
    if (err) setError(String(err));
    else setSent(true);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-navy-dark flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl gold-gradient flex items-center justify-center">
              <Zap className="w-6 h-6 text-navy-dark" />
            </div>
          </Link>
          <h1 className="text-2xl font-bold text-white">Reset Password</h1>
          <p className="text-gray-400 mt-1">We'll send you a reset link</p>
        </div>
        <div className="glass-card p-8">
          {sent ? (
            <div className="text-center py-4">
              <Mail className="w-12 h-12 text-gold mx-auto mb-4" />
              <p className="text-gray-300">Check your email for a password reset link.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-navy-dark border border-navy-light/30 text-white placeholder-gray-500 focus:border-gold/50 focus:outline-none"
                  placeholder="you@company.com" />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button type="submit" disabled={loading} className="w-full btn-gold py-3 flex items-center justify-center gap-2">
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send Reset Link'}
              </button>
            </form>
          )}
        </div>
        <div className="text-center mt-6">
          <Link to="/login" className="text-gold hover:text-gold-light inline-flex items-center gap-1 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
