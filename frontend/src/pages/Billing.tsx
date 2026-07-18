import { useState } from 'react';
import { CreditCard, CheckCircle, Zap, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';

const PLANS = [
  { id: 'starter', name: 'Starter', price: 0, period: 'Free forever', features: ['3 forms', '100 submissions/mo', 'Basic dashboard', 'Email support'], limits: { forms: 3, submissions: 100 } },
  { id: 'business', name: 'Business', price: 49, period: '/month', features: ['25 forms', 'Unlimited submissions', 'Bottleneck analysis', 'Export reports', 'Team roles', 'Priority support'], limits: { forms: 25, submissions: -1 } },
  { id: 'enterprise', name: 'Enterprise', price: 199, period: '/month', features: ['Unlimited forms', 'SLA tracking', 'API access', 'SSO / Microsoft', 'Custom branding', 'Dedicated support', 'Audit trail exports'], limits: { forms: -1, submissions: -1 } },
];

export default function Billing() {
  const { organization, hasPermission, user, refreshProfile } = useAuth();
  const currentPlan = organization?.plan || 'starter';
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const canManage = hasPermission(['super_admin']);

  const handleUpgrade = async (planId: string) => {
    if (!organization || !user) return;
    setUpgrading(planId);
    await apiFetch(`/api/organizations/${organization.id}`, {
      method: 'PUT',
      body: JSON.stringify({ plan: planId }),
    });
    await apiFetch(`/api/subscriptions/${organization.id}`, {
      method: 'PUT',
      body: JSON.stringify({ plan: planId, status: 'active' }),
    });
    await apiFetch('/api/activity-log', {
      method: 'POST',
      body: JSON.stringify({
        user_id: user.id,
        action: 'plan_change',
        entity_type: 'subscription',
        details: { from: currentPlan, to: planId },
      }),
    });
    await refreshProfile();
    setUpgrading(null);
  };

  return (
    <div className="app-page space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <CreditCard className="w-7 h-7 text-gold" /> Billing & Subscription
        </h1>
        <p className="text-gray-400 mt-1">Manage your plan and billing</p>
      </div>

      {/* Current plan */}
      <div className="glass-card p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-sm text-gray-400">Current Plan</span>
            <h3 className="text-xl font-bold text-white capitalize">{currentPlan}</h3>
          </div>
          <div className="px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-medium">Active</div>
        </div>
      </div>

      {/* Usage */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Usage This Month</h3>
        <div className="responsive-panel-grid">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-400">Forms</span>
              <span className="text-white">2 / {PLANS.find(p => p.id === currentPlan)?.limits.forms === -1 ? '∞' : PLANS.find(p => p.id === currentPlan)?.limits.forms}</span>
            </div>
            <div className="w-full h-2 rounded-full bg-navy-dark overflow-hidden">
              <div className="h-full rounded-full gold-gradient" style={{ width: '30%' }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-400">Submissions</span>
              <span className="text-white">47 / {PLANS.find(p => p.id === currentPlan)?.limits.submissions === -1 ? '∞' : PLANS.find(p => p.id === currentPlan)?.limits.submissions}</span>
            </div>
            <div className="w-full h-2 rounded-full bg-navy-dark overflow-hidden">
              <div className="h-full rounded-full gold-gradient" style={{ width: '47%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Plans */}
      <div className="responsive-card-grid">
        {PLANS.map(plan => {
          const isCurrent = plan.id === currentPlan;
          return (
            <div key={plan.id} className={`glass-card p-6 ${isCurrent ? 'border-gold/50' : ''}`}>
              {isCurrent && <div className="text-xs text-gold font-bold mb-2 flex items-center gap-1"><Zap className="w-3 h-3" /> CURRENT PLAN</div>}
              <h3 className="text-xl font-bold text-white">{plan.name}</h3>
              <div className="flex items-baseline gap-1 mt-2 mb-4">
                <span className="text-3xl font-bold text-white">{plan.price === 0 ? 'Free' : `$${plan.price}`}</span>
                {plan.price > 0 && <span className="text-gray-400">{plan.period}</span>}
              </div>
              <ul className="space-y-2 mb-6">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-300">
                    <CheckCircle className="w-4 h-4 text-gold flex-shrink-0" /> {f}
                  </li>
                ))}
              </ul>
              {canManage && !isCurrent && (
                <button onClick={() => handleUpgrade(plan.id)} disabled={!!upgrading}
                  className="w-full btn-gold flex items-center justify-center gap-2">
                  {upgrading === plan.id ? 'Processing...' : <>Upgrade <ArrowRight className="w-4 h-4" /></>}
                </button>
              )}
              {isCurrent && <div className="w-full btn-outline text-center opacity-50 cursor-default">Current Plan</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
