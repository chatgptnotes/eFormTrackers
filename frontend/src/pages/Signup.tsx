import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Zap, Mail, Lock, User, Building2, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '', fullName: '', orgName: '', department: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error: err } = await signUp(form.email, form.password, form.fullName, form.orgName, form.department);
    if (err) setError(typeof err === 'string' ? err : (err as Error)?.message || 'Signup failed. Please try again.');
    else setSuccess(true);
    setLoading(false);
  };

  const update = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [key]: e.target.value }));

  if (success) {
    return (
      <div className="min-h-screen bg-navy-dark flex items-center justify-center p-6">
        <div className="glass-card p-12 text-center max-w-md">
          <Mail className="w-16 h-16 text-gold mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Check your email</h2>
          <p className="text-gray-400 mb-6">We sent a confirmation link to <strong className="text-white">{form.email}</strong></p>
          <Link to="/login" className="btn-gold inline-block">Go to Login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-dark flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl gold-gradient flex items-center justify-center">
              <Zap className="w-6 h-6 text-navy-dark" />
            </div>
            <span className="text-2xl font-bold text-white">JotFlow</span>
          </Link>
          <h1 className="text-2xl font-bold text-white">Create your account</h1>
          <p className="text-gray-400 mt-1">Start tracking approvals in minutes</p>
        </div>
        <div className="glass-card p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            {[
              { key: 'fullName', label: 'Full Name', icon: User, type: 'text', placeholder: 'John Smith' },
              { key: 'email', label: 'Work Email', icon: Mail, type: 'email', placeholder: 'you@company.com' },
              { key: 'password', label: 'Password', icon: Lock, type: 'password', placeholder: '••••••••' },
              { key: 'orgName', label: 'Organization Name', icon: Building2, type: 'text', placeholder: 'Dubai Municipality' },
              { key: 'department', label: 'Department', icon: Building2, type: 'text', placeholder: 'IT Department' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-sm font-medium text-gray-300 mb-1">{f.label}</label>
                <div className="relative">
                  <f.icon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                  <input type={f.type} required value={form[f.key as keyof typeof form]} onChange={update(f.key)}
                    className="w-full pl-11 pr-4 py-3 rounded-xl bg-navy-dark border border-navy-light/30 text-white placeholder-gray-500 focus:border-gold/50 focus:outline-none transition-colors"
                    placeholder={f.placeholder} />
                </div>
              </div>
            ))}
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" disabled={loading} className="w-full btn-gold py-3 flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Create Account <ArrowRight className="w-5 h-5" /></>}
            </button>
          </form>
        </div>
        <p className="text-center text-gray-400 mt-6">
          Already have an account? <Link to="/login" className="text-gold hover:text-gold-light transition-colors">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
