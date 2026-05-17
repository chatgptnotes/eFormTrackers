import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Zap, BarChart3, Shield, Clock, Users, CheckCircle, ArrowRight, Star, Globe, Headphones } from 'lucide-react';

const FEATURES = [
  { icon: BarChart3, title: 'Real-Time Dashboard', desc: 'Track every approval stage with live updates and visual analytics.' },
  { icon: Clock, title: 'Bottleneck Detection', desc: 'Instantly identify where approvals are stuck and why.' },
  { icon: Shield, title: 'Compliance Ready', desc: 'Full audit trail for every action. Export anytime.' },
  { icon: Users, title: 'Team Collaboration', desc: 'Role-based access for admins, approvers, and viewers.' },
  { icon: Globe, title: 'Multi-Language', desc: 'English and Arabic support with RTL layout.' },
  { icon: Headphones, title: 'Dedicated Support', desc: 'Enterprise customers get priority support and SLA guarantees.' },
];

const PRICING = [
  { name: 'Starter', price: 'Free', period: '', features: ['3 forms', '100 submissions/mo', 'Basic dashboard', 'Email support'], cta: 'Get Started', popular: false },
  { name: 'Business', price: '$49', period: '/mo', features: ['25 forms', 'Unlimited submissions', 'Bottleneck analysis', 'Export reports', 'Team roles', 'Priority support'], cta: 'Start Free Trial', popular: true },
  { name: 'Enterprise', price: '$199', period: '/mo', features: ['Unlimited forms', 'SLA tracking', 'API access', 'SSO / Microsoft', 'Custom branding', 'Dedicated support', 'Audit trail exports'], cta: 'Contact Sales', popular: false },
];

const STATS = [
  { value: '150+', label: 'Government Entities' },
  { value: '50K+', label: 'Approvals Tracked' },
  { value: '3.2x', label: 'Faster Processing' },
  { value: '99.9%', label: 'Uptime' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-navy-dark">
      {/* Nav */}
      <nav className="border-b border-navy-light/20 bg-navy-dark/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gold-gradient flex items-center justify-center">
              <Zap className="w-5 h-5 text-navy-dark" />
            </div>
            <span className="text-xl font-bold text-white">JotFlow</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-gray-400 hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="text-gray-400 hover:text-white transition-colors">Pricing</a>
            <Link to="/login" className="text-gray-400 hover:text-white transition-colors">Sign In</Link>
            <Link to="/signup" className="btn-gold text-sm">Get Started</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 py-24 text-center">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gold/10 border border-gold/20 mb-8">
            <Star className="w-4 h-4 text-gold" />
            <span className="text-sm text-gold font-medium">Trusted by 150+ Government Entities</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
            See Where Every<br />
            <span className="text-gold">Approval Is Stuck</span>
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
            Transform your JotForm workflows into a real-time approval tracking dashboard.
            Identify bottlenecks, ensure compliance, and accelerate decisions.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link to="/signup" className="btn-gold text-lg px-8 py-3 flex items-center gap-2">
              Start Free <ArrowRight className="w-5 h-5" />
            </Link>
            <a href="#features" className="btn-outline text-lg px-8 py-3">See How It Works</a>
          </div>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-20">
          {STATS.map(s => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-card p-6">
              <div className="text-3xl font-bold text-gold">{s.value}</div>
              <div className="text-sm text-gray-400 mt-1">{s.label}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-white mb-4">Everything You Need</h2>
          <p className="text-gray-400 text-lg">Powerful tools to manage approval workflows at scale.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {FEATURES.map((f, i) => (
            <motion.div key={f.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} viewport={{ once: true }} className="glass-card-hover p-8">
              <div className="w-12 h-12 rounded-xl bg-gold/10 flex items-center justify-center mb-4">
                <f.icon className="w-6 h-6 text-gold" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-gray-400">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-white mb-4">Simple, Transparent Pricing</h2>
          <p className="text-gray-400 text-lg">Start free. Scale as you grow.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {PRICING.map(p => (
            <motion.div key={p.name} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              className={`glass-card p-8 relative ${p.popular ? 'border-gold/50 shadow-gold/10 shadow-2xl' : ''}`}>
              {p.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full gold-gradient text-navy-dark text-xs font-bold">
                  MOST POPULAR
                </div>
              )}
              <h3 className="text-xl font-semibold text-white mb-2">{p.name}</h3>
              <div className="flex items-baseline gap-1 mb-6">
                <span className="text-4xl font-bold text-white">{p.price}</span>
                <span className="text-gray-400">{p.period}</span>
              </div>
              <ul className="space-y-3 mb-8">
                {p.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-gray-300">
                    <CheckCircle className="w-5 h-5 text-gold flex-shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link to="/signup" className={p.popular ? 'btn-gold w-full block text-center' : 'btn-outline w-full block text-center'}>
                {p.cta}
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 py-24 text-center">
        <div className="glass-card p-12 border-gold/20">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to Transform Your Workflows?</h2>
          <p className="text-gray-400 mb-8">Join 150+ government entities already using JotFlow.</p>
          <div className="flex items-center justify-center gap-4">
            <Link to="/signup" className="btn-gold text-lg px-8 py-3">Start Free Trial</Link>
            <a href="mailto:support@jotflow.com" className="btn-outline text-lg px-8 py-3">Request Demo</a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-navy-light/20 py-8">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between text-sm text-gray-500">
          <span>© 2024 JotFlow. All rights reserved.</span>
          <div className="flex gap-6">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
            <a href="#" className="hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
