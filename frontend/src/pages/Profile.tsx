import { useRef, useState } from 'react';
import { Camera, Save, Loader2, Moon, Sun, Globe, User, Bell, Layers } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { apiFetch } from '../lib/api';

export default function Profile() {
  const { profile, user, updateProfile } = useAuth();
  const { language, setLanguage, themeMode, toggleTheme } = useApp();

  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [department, setDepartment] = useState(profile?.department || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState('');

  const prefs = (profile?.preferences || {}) as Record<string, unknown>;
  const [emailNotifs, setEmailNotifs] = useState(prefs.emailNotifications !== false);
  const [defaultView, setDefaultView] = useState((prefs.defaultView as string) || 'dashboard');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const initials = fullName
    ? fullName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : (user?.email?.[0] || '?').toUpperCase();

  /* ── Avatar upload ──────────────────────────────────────────────────── */
  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setAvatarError('Please select an image file (JPG, PNG, GIF, WebP).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Image must be smaller than 5 MB.');
      return;
    }
    setAvatarError('');
    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const res = await fetch('/api/upload-avatar', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const { avatarUrl: uploadedUrl } = await res.json();
      setAvatarUrl(uploadedUrl + `?t=${Date.now()}`);
    } catch {
      // Fallback: show a local preview so the user can still paste a URL
      const reader = new FileReader();
      reader.onload = ev => setAvatarUrl(ev.target?.result as string);
      reader.readAsDataURL(file);
      setAvatarError('Upload unavailable — using local preview. Changes will be saved when you click Save.');
    } finally {
      setAvatarUploading(false);
    }
  };

  /* ── Save ───────────────────────────────────────────────────────────── */
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await updateProfile({
      full_name: fullName,
      department,
      avatar_url: avatarUrl,
      preferences: {
        ...prefs,
        theme: themeMode,
        language,
        emailNotifications: emailNotifs,
        defaultView,
      },
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  /* ── UI ─────────────────────────────────────────────────────────────── */
  const inputCls =
    'w-full px-3 py-2.5 rounded-[4px] bg-white border border-jf-border text-jf-navy text-sm ' +
    'placeholder-jf-text-secondary focus:border-jf-blue focus:ring-2 focus:ring-jf-blue/10 focus:outline-none transition-all ' +
    // dark mode fallback
    'dark:bg-navy-dark dark:border-navy-light/30 dark:text-white dark:placeholder-gray-500 dark:focus:border-gold/50';

  const labelCls = 'block text-xs font-semibold text-jf-text-secondary uppercase tracking-wide mb-1.5';

  return (
    <div className="app-page max-w-2xl mx-auto space-y-6 pb-12">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <User className="w-6 h-6 text-gold" />
          My Profile
        </h1>
        <p className="text-gray-400 text-sm mt-1">Manage your personal information and preferences</p>
      </div>

      <form onSubmit={handleSave} className="space-y-5">

        {/* ── Avatar + Personal Info ── */}
        <div className="glass-card p-6 space-y-5">
          <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Personal Information</h3>

          {/* Avatar section */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
            <div className="relative flex-shrink-0">
              {/* Avatar circle */}
              <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-jf-border bg-jf-blue-light flex items-center justify-center">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl font-bold text-jf-blue">{initials}</span>
                )}
              </div>
              {/* Upload button overlay */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-jf-blue border-2 border-white flex items-center justify-center shadow-jf hover:bg-jf-blue-dark transition-colors disabled:opacity-60"
                title="Change profile photo"
              >
                {avatarUploading
                  ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                  : <Camera className="w-3.5 h-3.5 text-white" />}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarFile}
              />
            </div>

            <div className="min-w-0 flex-1 space-y-1 text-center sm:text-left">
              <p className="text-sm font-semibold text-white">{fullName || 'Your Name'}</p>
              <p className="text-xs text-gray-500">{user?.email}</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                className="text-xs text-jf-blue hover:text-jf-blue-dark font-medium transition-colors disabled:opacity-60"
              >
                {avatarUploading ? 'Uploading…' : 'Change photo'}
              </button>
              {avatarError && <p className="text-xs text-amber-400 mt-1">{avatarError}</p>}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className={labelCls}>Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Your full name"
              className={inputCls}
            />
          </div>

          {/* Department */}
          <div>
            <label className={labelCls}>Department</label>
            <input
              type="text"
              value={department}
              onChange={e => setDepartment(e.target.value)}
              placeholder="e.g. Media Operations"
              className={inputCls}
            />
          </div>

          {/* Email (read-only) */}
          <div>
            <label className={labelCls}>Email Address</label>
            <input
              type="email"
              value={user?.email || ''}
              readOnly
              className={inputCls + ' opacity-60 cursor-not-allowed'}
            />
            <p className="text-xs text-gray-500 mt-1">Email cannot be changed here. Contact your administrator.</p>
          </div>
        </div>

        {/* ── Preferences ── */}
        <div className="glass-card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Preferences</h3>

          {/* Theme toggle */}
          <div className="flex items-start justify-between gap-3 py-1">
            <div className="flex items-center gap-3">
              {themeMode === 'dark'
                ? <Moon className="w-4 h-4 text-gold" />
                : <Sun className="w-4 h-4 text-gold" />}
              <div>
                <p className="text-sm font-medium text-white">Theme</p>
                <p className="text-xs text-gray-500">{themeMode === 'dark' ? 'Dark mode' : 'Light mode (JotForm style)'}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className={`w-11 h-6 rounded-full transition-colors relative ${themeMode === 'dark' ? 'bg-gold' : 'bg-jf-blue'}`}
              role="switch"
              aria-checked={themeMode === 'dark'}
            >
              <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform shadow-sm ${themeMode === 'dark' ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Language */}
          <div className="flex flex-col gap-3 py-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Globe className="w-4 h-4 text-gold" />
              <div>
                <p className="text-sm font-medium text-white">Language</p>
                <p className="text-xs text-gray-500">Dashboard display language</p>
              </div>
            </div>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value as 'en' | 'ar')}
              className="px-3 py-1.5 rounded-[4px] bg-navy-dark border border-navy-light/30 text-white text-sm focus:border-gold/50 focus:outline-none"
            >
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
          </div>

          {/* Email notifications */}
          <div className="flex items-start justify-between gap-3 py-1">
            <div className="flex items-center gap-3">
              <Bell className="w-4 h-4 text-gold" />
              <div>
                <p className="text-sm font-medium text-white">Email Notifications</p>
                <p className="text-xs text-gray-500">Get notified when approvals are assigned to you</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEmailNotifs(!emailNotifs)}
              className={`w-11 h-6 rounded-full transition-colors relative ${emailNotifs ? 'bg-gold' : 'bg-navy-light'}`}
              role="switch"
              aria-checked={emailNotifs}
            >
              <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform shadow-sm ${emailNotifs ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Default view */}
          <div className="flex flex-col gap-3 py-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Layers className="w-4 h-4 text-gold" />
              <div>
                <p className="text-sm font-medium text-white">Default View</p>
                <p className="text-xs text-gray-500">Page shown after login</p>
              </div>
            </div>
            <select
              value={defaultView}
              onChange={e => setDefaultView(e.target.value)}
              className="px-3 py-1.5 rounded-[4px] bg-navy-dark border border-navy-light/30 text-white text-sm focus:border-gold/50 focus:outline-none"
            >
              <option value="dashboard">Director Dashboard</option>
              <option value="tracker">Workflow Tracker</option>
              <option value="bottlenecks">Bottleneck Analysis</option>
            </select>
          </div>
        </div>

        {/* Save button */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-[4px] bg-jf-blue hover:bg-jf-blue-dark text-white text-sm font-semibold transition-colors disabled:opacity-60 shadow-jf"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Changes'}
          </button>
          {saved && (
            <span className="text-sm text-jf-green font-medium">Changes saved successfully.</span>
          )}
        </div>
      </form>
    </div>
  );
}
