import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, LineChart, Line, Legend, PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import { TrendingUp, Calendar, Award, Target, Brain, Download, ChevronRight, BarChart3, Users, Clock, Zap, Star, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Submission } from '../types';
import { exportChartAsPng } from '../services/exportService';

interface Props {
  data: ReturnType<typeof import('../hooks/useSubmissions').useSubmissions>;
}

export default function AdvancedAnalytics({ data }: Props) {
  const { allSubmissions, departmentStats } = data;
  const { slaConfig, t } = useApp();
  const [activeTab, setActiveTab] = useState<'scorecards' | 'leaderboard' | 'predictive' | 'heatmap' | 'formAnalytics' | 'timeCompare'>('scorecards');
  const [drillDown, setDrillDown] = useState<{ type: string; value: string } | null>(null);

  // Department Scorecards
  const scorecards = useMemo(() => {
    return departmentStats.map(dept => {
      const deptSubs = allSubmissions.filter(s => s.submittedBy.department === dept.department);
      const completedSubs = deptSubs.filter(s => s.currentApprovalLevel === 'completed');
      const avgTime = completedSubs.length > 0
        ? Math.round(completedSubs.reduce((sum, s) => sum + s.totalDaysSinceSubmission, 0) / completedSubs.length)
        : 0;
      const pendingSubs = deptSubs.filter(s => typeof s.currentApprovalLevel === 'number');
      const criticalCount = pendingSubs.filter(s => s.daysAtCurrentLevel > 7).length;
      const throughputRate = deptSubs.length > 0 ? Math.round((completedSubs.length / deptSubs.length) * 100) : 0;
      const score = Math.max(0, 100 - (avgTime * 2) - (criticalCount * 5) + throughputRate);
      return { ...dept, avgTime, criticalCount, throughputRate, score: Math.min(100, Math.max(0, score)) };
    }).sort((a, b) => b.score - a.score);
  }, [allSubmissions, departmentStats]);

  // Approver Leaderboard
  const approverStats = useMemo(() => {
    const map = new Map<string, { name: string; approved: number; totalDays: number; pending: number }>();
    allSubmissions.forEach(s => {
      s.approvalHistory.forEach(a => {
        const entry = map.get(a.approverName) || { name: a.approverName, approved: 0, totalDays: 0, pending: 0 };
        if (a.status === 'approved') { entry.approved++; entry.totalDays += 3; } // simulated days
        if (a.status === 'pending') entry.pending++;
        map.set(a.approverName, entry);
      });
    });
    return Array.from(map.values())
      .map(a => ({ ...a, avgDays: a.approved > 0 ? Math.round((a.totalDays / a.approved) * 10) / 10 : 0 }))
      .sort((a, b) => b.approved - a.approved);
  }, [allSubmissions]);

  // Predictive Analytics
  const predictions = useMemo(() => {
    const pending = allSubmissions.filter(s => typeof s.currentApprovalLevel === 'number');
    const completed = allSubmissions.filter(s => s.currentApprovalLevel === 'completed');
    const avgCompletionDays = completed.length > 0
      ? Math.round(completed.reduce((s, i) => s + i.totalDaysSinceSubmission, 0) / completed.length) : 15;
    const dailyRate = completed.length / 90; // over 90 days
    const backlogClearDate = new Date();
    backlogClearDate.setDate(backlogClearDate.getDate() + Math.ceil(pending.length / Math.max(dailyRate, 0.1)));
    return { avgCompletionDays, dailyRate: Math.round(dailyRate * 10) / 10, pending: pending.length, backlogClearDate, completed: completed.length };
  }, [allSubmissions]);

  // Calendar Heatmap (GitHub style - 52 weeks)
  const calendarData = useMemo(() => {
    const weeks: { date: string; count: number; level: number }[][] = [];
    const today = new Date();
    for (let w = 51; w >= 0; w--) {
      const week: { date: string; count: number; level: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(today);
        date.setDate(date.getDate() - (w * 7 + (6 - d)));
        const dateStr = date.toISOString().split('T')[0];
        const count = allSubmissions.filter(s => s.submissionDate === dateStr).length;
        week.push({ date: dateStr, count, level: count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 10 ? 3 : 4 });
      }
      weeks.push(week);
    }
    return weeks;
  }, [allSubmissions]);

  // Form Template Analytics
  const formAnalytics = useMemo(() => {
    const map = new Map<string, { formId: string; title: string; total: number; completed: number; avgDays: number; pending: number }>();
    allSubmissions.forEach(s => {
      const entry = map.get(s.formId) || { formId: s.formId, title: s.formTitle, total: 0, completed: 0, avgDays: 0, pending: 0 };
      entry.total++;
      if (s.currentApprovalLevel === 'completed') { entry.completed++; entry.avgDays += s.totalDaysSinceSubmission; }
      else if (typeof s.currentApprovalLevel === 'number') entry.pending++;
      map.set(s.formId, entry);
    });
    return Array.from(map.values()).map(f => ({
      ...f,
      avgDays: f.completed > 0 ? Math.round(f.avgDays / f.completed) : 0,
      completionRate: f.total > 0 ? Math.round((f.completed / f.total) * 100) : 0,
    })).sort((a, b) => b.total - a.total);
  }, [allSubmissions]);

  // Time comparison
  const timeCompare = useMemo(() => {
    const now = new Date();
    const thisWeek = allSubmissions.filter(s => {
      const d = new Date(s.submissionDate);
      const diff = (now.getTime() - d.getTime()) / 86400000;
      return diff <= 7;
    });
    const lastWeek = allSubmissions.filter(s => {
      const d = new Date(s.submissionDate);
      const diff = (now.getTime() - d.getTime()) / 86400000;
      return diff > 7 && diff <= 14;
    });
    return {
      thisWeek: { total: thisWeek.length, completed: thisWeek.filter(s => s.currentApprovalLevel === 'completed').length },
      lastWeek: { total: lastWeek.length, completed: lastWeek.filter(s => s.currentApprovalLevel === 'completed').length },
    };
  }, [allSubmissions]);

  const COLORS = ['#D4A843', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#F59E0B', '#EC4899', '#6366F1'];
  const heatColors = ['#1B2A4A', '#1a3a2a', '#1a5a2a', '#2a8a3a', '#3aba4a'];

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="glass-card p-3 text-sm">
        <p className="text-gray-400 mb-1">{label}</p>
        {payload.map((p: any, i: number) => (
          <p key={i} style={{ color: p.color }} className="font-medium">{p.name}: {p.value}</p>
        ))}
      </div>
    );
  };

  const tabs = [
    { key: 'scorecards', icon: Target, label: 'Scorecards' },
    { key: 'leaderboard', icon: Award, label: 'Leaderboard' },
    { key: 'predictive', icon: Brain, label: 'Predictive' },
    { key: 'heatmap', icon: Calendar, label: 'Heatmap' },
    { key: 'formAnalytics', icon: BarChart3, label: 'Form Analytics' },
    { key: 'timeCompare', icon: TrendingUp, label: 'Time Compare' },
  ] as const;

  // Drill-down data
  const drillDownData = useMemo(() => {
    if (!drillDown) return [];
    if (drillDown.type === 'department') {
      return allSubmissions.filter(s => s.submittedBy.department === drillDown.value);
    }
    if (drillDown.type === 'form') {
      return allSubmissions.filter(s => s.formId === drillDown.value);
    }
    if (drillDown.type === 'approver') {
      return allSubmissions.filter(s => s.approvalHistory.some(a => a.approverName === drillDown.value));
    }
    return [];
  }, [drillDown, allSubmissions]);

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setDrillDown(null); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === tab.key ? 'bg-gold/20 text-gold border border-gold/30' : 'text-gray-400 hover:text-white hover:bg-navy-light/30'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Drill Down Overlay */}
      {drillDown && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="glass-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gold">Drill Down: {drillDown.type} — {drillDown.value} ({drillDownData.length} submissions)</h3>
            <button onClick={() => setDrillDown(null)} className="text-xs text-gray-400 hover:text-white">✕ Close</button>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-1">
            {drillDownData.slice(0, 20).map(s => (
              <div key={s.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-navy-light/20 text-xs">
                <span className="font-mono text-gold">{s.referenceNumber}</span>
                <span className="text-white">{s.title}</span>
                <span className="text-gray-400">{s.submittedBy.department}</span>
                <span className={`font-bold ${s.overallStatus === 'critical' ? 'text-red-400' : 'text-gray-300'}`}>
                  {typeof s.currentApprovalLevel === 'number' ? `L${s.currentApprovalLevel} • ${s.daysAtCurrentLevel}d` : String(s.currentApprovalLevel)}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Department Scorecards */}
      {activeTab === 'scorecards' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {scorecards.map((dept, i) => (
            <motion.div
              key={dept.department}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => setDrillDown({ type: 'department', value: dept.department })}
              className="glass-card-hover p-5 cursor-pointer"
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-white">{dept.department}</h4>
                <div className={`px-2 py-0.5 rounded-full text-xs font-bold ${dept.score >= 70 ? 'bg-emerald-500/20 text-emerald-400' : dept.score >= 40 ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'}`}>
                  {dept.score}/100
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3" /> Avg Time</span>
                  <span className="text-white font-medium">{dept.avgTime}d</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 flex items-center gap-1"><Users className="w-3 h-3" /> Backlog</span>
                  <span className="text-white font-medium">{dept.pending}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 flex items-center gap-1"><Zap className="w-3 h-3" /> Throughput</span>
                  <span className="text-white font-medium">{dept.throughputRate}%</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Completed</span>
                  <span className="text-emerald-400 font-medium">{dept.completed}</span>
                </div>
                {dept.criticalCount > 0 && (
                  <div className="text-xs text-red-400 flex items-center gap-1 mt-1">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    {dept.criticalCount} critical items
                  </div>
                )}
              </div>
              {/* Score bar */}
              <div className="mt-3 h-1.5 rounded-full bg-navy-light/30 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${dept.score}%` }}
                  transition={{ delay: i * 0.05 + 0.3, duration: 0.8 }}
                  className={`h-full rounded-full ${dept.score >= 70 ? 'bg-emerald-500' : dept.score >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                />
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Approver Leaderboard */}
      {activeTab === 'leaderboard' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card p-6">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Award className="w-5 h-5 text-gold" /> Approver Performance Rankings</h3>
          <div className="space-y-2">
            {approverStats.slice(0, 15).map((approver, i) => (
              <motion.div
                key={approver.name}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => setDrillDown({ type: 'approver', value: approver.name })}
                className="flex items-center gap-4 p-3 rounded-xl hover:bg-navy-light/20 cursor-pointer transition-colors"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  i === 0 ? 'bg-gold/20 text-gold' : i === 1 ? 'bg-gray-300/20 text-gray-300' : i === 2 ? 'bg-amber-700/20 text-amber-600' : 'bg-navy-light/30 text-gray-400'
                }`}>
                  {i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{approver.name}</p>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                    <span>{approver.approved} approved</span>
                    <span>•</span>
                    <span>{approver.avgDays}d avg</span>
                    {approver.pending > 0 && <><span>•</span><span className="text-amber-400">{approver.pending} pending</span></>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-32 h-2 rounded-full bg-navy-light/30 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (approver.approved / Math.max(1, approverStats[0]?.approved || 1)) * 100)}%` }}
                      transition={{ delay: i * 0.03 + 0.2, duration: 0.6 }}
                      className="h-full rounded-full bg-gold"
                    />
                  </div>
                  <span className="text-sm font-bold text-white w-8 text-right">{approver.approved}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Predictive Analytics */}
      {activeTab === 'predictive' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { label: 'Avg Completion Time', value: `${predictions.avgCompletionDays}d`, icon: Clock, color: 'text-blue-400' },
              { label: 'Daily Throughput', value: `${predictions.dailyRate}/day`, icon: Zap, color: 'text-emerald-400' },
              { label: 'Current Backlog', value: predictions.pending.toString(), icon: BarChart3, color: 'text-amber-400' },
              { label: 'Backlog Clear By', value: predictions.backlogClearDate.toLocaleDateString(), icon: Calendar, color: 'text-gold' },
            ].map((metric, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="glass-card p-5">
                <div className="flex items-center gap-2 mb-2">
                  <metric.icon className={`w-4 h-4 ${metric.color}`} />
                  <span className="text-xs text-gray-400">{metric.label}</span>
                </div>
                <p className="text-2xl font-bold text-white">{metric.value}</p>
              </motion.div>
            ))}
          </div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="glass-card p-6">
            <h3 className="text-lg font-bold text-white mb-4">Prediction: Submissions per Approval Level</h3>
            <p className="text-sm text-gray-400 mb-4">
              At current rate ({predictions.dailyRate} completions/day), the backlog of {predictions.pending} items will clear by{' '}
              <span className="text-gold font-bold">{predictions.backlogClearDate.toLocaleDateString()}</span>.
            </p>
            <div className="space-y-3">
              {[1, 2, 3, 4].map(level => {
                const atLevel = allSubmissions.filter(s => s.currentApprovalLevel === level);
                const avgDaysAtLevel = atLevel.length > 0 ? Math.round(atLevel.reduce((s, i) => s + i.daysAtCurrentLevel, 0) / atLevel.length) : 0;
                const predicted = Math.round(avgDaysAtLevel * 1.2);
                return (
                  <div key={level} className="flex items-center gap-3">
                    <span className="w-20 text-sm text-gray-400">Level {level}</span>
                    <div className="flex-1 h-8 rounded-lg bg-navy-light/20 relative overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, (atLevel.length / Math.max(1, allSubmissions.length)) * 300)}%` }}
                        transition={{ duration: 0.8 }}
                        className="h-full rounded-lg bg-gradient-to-r from-gold/50 to-gold/20"
                      />
                      <span className="absolute inset-0 flex items-center px-3 text-xs font-medium text-white">
                        {atLevel.length} items • avg {avgDaysAtLevel}d • predicted {predicted}d to clear
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}

      {/* Calendar Heatmap */}
      {activeTab === 'heatmap' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card p-6">
          <h3 className="text-lg font-bold text-white mb-4">Submission Volume — Past Year</h3>
          <div className="overflow-x-auto">
            <div className="flex gap-0.5" style={{ minWidth: '800px' }}>
              {calendarData.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-0.5">
                  {week.map((day, di) => (
                    <div
                      key={di}
                      className="w-3 h-3 rounded-sm transition-colors"
                      style={{ backgroundColor: heatColors[day.level] }}
                      title={`${day.date}: ${day.count} submissions`}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 mt-3 text-xs text-gray-500">
              <span>Less</span>
              {heatColors.map((c, i) => (
                <div key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} />
              ))}
              <span>More</span>
            </div>
          </div>
        </motion.div>
      )}

      {/* Form Template Analytics */}
      {activeTab === 'formAnalytics' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card p-6" id="form-analytics-chart">
              <h3 className="text-lg font-bold text-white mb-4">Submissions by Form Type</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={formAnalytics} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#243656" />
                  <XAxis type="number" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <YAxis type="category" dataKey="title" tick={{ fill: '#9CA3AF', fontSize: 10 }} width={140} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="completed" fill="#10B981" name="Completed" stackId="a" />
                  <Bar dataKey="pending" fill="#F59E0B" name="Pending" stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </motion.div>

            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card p-6">
              <h3 className="text-lg font-bold text-white mb-4">Avg Completion Time by Form</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={formAnalytics.filter(f => f.avgDays > 0)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#243656" />
                  <XAxis dataKey="title" tick={{ fill: '#9CA3AF', fontSize: 9 }} angle={-30} textAnchor="end" height={80} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 12 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="avgDays" fill="#D4A843" radius={[8, 8, 0, 0]} name="Avg Days" />
                </BarChart>
              </ResponsiveContainer>
            </motion.div>
          </div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-navy-light/20">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Form</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Total</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Completed</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Pending</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Avg Days</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Rate</th>
                </tr>
              </thead>
              <tbody>
                {formAnalytics.map(f => (
                  <tr key={f.formId} className="border-b border-navy-light/10 hover:bg-navy-light/20 cursor-pointer" onClick={() => setDrillDown({ type: 'form', value: f.formId })}>
                    <td className="px-4 py-3 text-sm text-white">{f.title}</td>
                    <td className="px-4 py-3 text-sm text-gray-300">{f.total}</td>
                    <td className="px-4 py-3 text-sm text-emerald-400">{f.completed}</td>
                    <td className="px-4 py-3 text-sm text-amber-400">{f.pending}</td>
                    <td className="px-4 py-3 text-sm text-gray-300">{f.avgDays}d</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 rounded-full bg-navy-light/30 overflow-hidden">
                          <div className="h-full rounded-full bg-gold" style={{ width: `${f.completionRate}%` }} />
                        </div>
                        <span className="text-xs text-gray-400">{f.completionRate}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        </div>
      )}

      {/* Time Comparison */}
      {activeTab === 'timeCompare' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
            <h3 className="text-lg font-bold text-white mb-4">This Week vs Last Week</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Submissions</span>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-white">{timeCompare.thisWeek.total}</span>
                  <span className={`flex items-center gap-1 text-xs font-bold ${timeCompare.thisWeek.total >= timeCompare.lastWeek.total ? 'text-emerald-400' : 'text-red-400'}`}>
                    {timeCompare.thisWeek.total >= timeCompare.lastWeek.total ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                    {Math.abs(timeCompare.thisWeek.total - timeCompare.lastWeek.total)}
                  </span>
                  <span className="text-xs text-gray-500">vs {timeCompare.lastWeek.total}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Completed</span>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-emerald-400">{timeCompare.thisWeek.completed}</span>
                  <span className={`flex items-center gap-1 text-xs font-bold ${timeCompare.thisWeek.completed >= timeCompare.lastWeek.completed ? 'text-emerald-400' : 'text-red-400'}`}>
                    {timeCompare.thisWeek.completed >= timeCompare.lastWeek.completed ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                    {Math.abs(timeCompare.thisWeek.completed - timeCompare.lastWeek.completed)}
                  </span>
                  <span className="text-xs text-gray-500">vs {timeCompare.lastWeek.completed}</span>
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-6">
            <h3 className="text-lg font-bold text-white mb-4">Trend Summary</h3>
            <div className="space-y-3">
              {[
                { label: 'Submission Rate', value: `${Math.round((timeCompare.thisWeek.total / 7) * 10) / 10}/day`, trend: timeCompare.thisWeek.total >= timeCompare.lastWeek.total },
                { label: 'Completion Rate', value: `${timeCompare.thisWeek.total > 0 ? Math.round((timeCompare.thisWeek.completed / timeCompare.thisWeek.total) * 100) : 0}%`, trend: true },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-navy-dark/50">
                  <span className="text-sm text-gray-400">{item.label}</span>
                  <span className={`text-sm font-bold ${item.trend ? 'text-emerald-400' : 'text-red-400'}`}>{item.value}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
