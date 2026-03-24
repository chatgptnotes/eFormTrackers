import { useState, useEffect, useRef } from 'react';
import { Bell, X, CheckCheck, AlertTriangle, FileCheck, Clock, UserPlus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  data: Record<string, unknown>;
  created_at: string;
}

const TYPE_ICONS: Record<string, typeof Bell> = {
  submission: FileCheck,
  sla_breach: AlertTriangle,
  approval_needed: Clock,
  escalation: AlertTriangle,
  team_invite: UserPlus,
};

const TYPE_COLORS: Record<string, string> = {
  submission: 'text-blue-400',
  sla_breach: 'text-red-400',
  approval_needed: 'text-amber-400',
  escalation: 'text-red-400',
  team_invite: 'text-emerald-400',
};

export default function NotificationBell() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase.from('notifications').select('*').eq('user_email', user.email).order('created_at', { ascending: false }).limit(20);
      if (data && data.length > 0) setNotifications(data as Notification[]);
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const markAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    if (user) await supabase.from('notifications').update({ read: true }).eq('user_email', user.email).eq('read', false);
  };

  const markRead = async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    await supabase.from('notifications').update({ read: true }).eq('id', id);
  };

  const timeAgo = (date: string) => {
    const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return `${Math.floor(mins / 1440)}d ago`;
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="relative p-2 rounded-xl bg-navy-light/30 hover:bg-navy-light/50 text-gray-400 hover:text-gold transition-all">
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-bold">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-96 glass-card overflow-hidden z-50 shadow-2xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-navy-light/20">
            <h3 className="font-semibold text-white">Notifications</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-xs text-gold hover:text-gold-light flex items-center gap-1">
                  <CheckCheck className="w-3 h-3" /> Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-gray-500">No notifications</div>
            ) : (
              notifications.map(n => {
                const Icon = TYPE_ICONS[n.type] || Bell;
                return (
                  <button key={n.id} onClick={() => markRead(n.id)}
                    className={`w-full text-left px-4 py-3 border-b border-navy-light/10 hover:bg-navy-light/10 transition-colors ${!n.read ? 'bg-gold/5' : ''}`}>
                    <div className="flex gap-3">
                      <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${TYPE_COLORS[n.type] || 'text-gray-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className={`text-sm font-medium ${!n.read ? 'text-white' : 'text-gray-300'}`}>{n.title}</span>
                          <span className="text-xs text-gray-500 ml-2">{timeAgo(n.created_at)}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{n.message}</p>
                      </div>
                      {!n.read && <div className="w-2 h-2 rounded-full bg-gold mt-2 flex-shrink-0" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
