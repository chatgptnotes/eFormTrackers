import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, Settings, LogOut, CreditCard, Shield, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  approver: 'Approver',
  viewer: 'Viewer',
  user: 'User',
};

export default function UserDropdown() {
  const { profile, signOut, orgRole } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-navy-light/30 transition-all">
        <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center text-gold font-semibold text-sm">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt={profile.full_name || 'User avatar'} className="w-full h-full rounded-full object-cover" />
          ) : (
            (profile?.full_name?.[0] || '?')
          )}
        </div>
        <div className="hidden md:block text-left">
          <div className="text-sm font-medium text-white">{profile?.full_name || 'User'}</div>
          <div className="text-xs text-gray-400">{ROLE_LABELS[orgRole] || orgRole}</div>
        </div>
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-56 glass-card overflow-hidden z-50 shadow-2xl py-2">
          <Link to="/app/profile" onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-2.5 text-gray-300 hover:text-white hover:bg-navy-light/30 transition-colors">
            <User className="w-4 h-4" /> Profile & Settings
          </Link>
          {/* Billing hidden */}
          {/* <Link to="/app/billing" onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-2.5 text-gray-300 hover:text-white hover:bg-navy-light/30 transition-colors">
            <CreditCard className="w-4 h-4" /> Billing
          </Link> */}
          <Link to="/app/team" onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-2.5 text-gray-300 hover:text-white hover:bg-navy-light/30 transition-colors">
            <Shield className="w-4 h-4" /> Team
          </Link>
          <Link to="/app/settings" onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-2.5 text-gray-300 hover:text-white hover:bg-navy-light/30 transition-colors">
            <Settings className="w-4 h-4" /> Settings
          </Link>
          <div className="my-1 border-t border-navy-light/20" />
          <button onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-red-400 hover:text-red-300 hover:bg-navy-light/30 transition-colors">
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
