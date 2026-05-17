import { useState } from 'react';
import { Building2, Save, Loader2, Palette } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';

export default function OrgSettings() {
  const { organization, hasPermission, refreshProfile } = useAuth();
  const [name, setName] = useState(organization?.name || '');
  const [logoUrl, setLogoUrl] = useState(organization?.logo_url || '');
  const [primaryColor, setPrimaryColor] = useState((organization?.branding as Record<string, string>)?.primaryColor || '#D4A843');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const canEdit = hasPermission(['super_admin']);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization) return;
    setSaving(true);
    await apiFetch(`/api/organizations/${organization.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, logo_url: logoUrl || null, branding: { primaryColor } }),
    });
    await refreshProfile();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Building2 className="w-7 h-7 text-gold" /> Organization Settings
        </h1>
        <p className="text-gray-400 mt-1">Manage your organization's profile and branding</p>
      </div>

      <form onSubmit={handleSave} className="glass-card p-8 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Organization Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} disabled={!canEdit}
            className="w-full px-4 py-3 rounded-xl bg-navy-dark border border-navy-light/30 text-white focus:border-gold/50 focus:outline-none disabled:opacity-50" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Logo URL</label>
          <input type="url" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} disabled={!canEdit}
            className="w-full px-4 py-3 rounded-xl bg-navy-dark border border-navy-light/30 text-white placeholder-gray-500 focus:border-gold/50 focus:outline-none disabled:opacity-50"
            placeholder="https://example.com/logo.png" />
          {logoUrl && <img src={logoUrl} alt="Logo preview" className="mt-3 h-16 rounded-lg object-contain" />}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1 flex items-center gap-2">
            <Palette className="w-4 h-4" /> Brand Color
          </label>
          <div className="flex items-center gap-3">
            <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} disabled={!canEdit}
              className="w-12 h-12 rounded-xl border border-navy-light/30 cursor-pointer" />
            <input type="text" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} disabled={!canEdit}
              className="px-4 py-3 rounded-xl bg-navy-dark border border-navy-light/30 text-white focus:border-gold/50 focus:outline-none disabled:opacity-50 w-40" />
          </div>
        </div>
        <div className="pt-4 border-t border-navy-light/20">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">Current Plan:</span>
            <span className="px-3 py-1 rounded-lg bg-gold/10 text-gold border border-gold/20 text-sm font-medium capitalize">{organization?.plan || 'starter'}</span>
          </div>
        </div>
        {canEdit && (
          <button type="submit" disabled={saving} className="btn-gold flex items-center gap-2">
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            {saved ? 'Saved!' : 'Save Changes'}
          </button>
        )}
      </form>
    </div>
  );
}
