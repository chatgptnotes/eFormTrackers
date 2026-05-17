import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import { AlertTriangle, Clock, TrendingUp, Download, User } from 'lucide-react';
import { exportBottleneckPdf, exportChartAsPng } from '../services/exportService';

interface Props {
  data: ReturnType<typeof import('../hooks/useSubmissions').useSubmissions>;
}

export default function BottleneckAnalysis({ data }: Props) {
  const { bottleneckData, heatmapData, allSubmissions } = data;

  const stuckForms = allSubmissions
    .filter(s => typeof s.currentApprovalLevel === 'number' && s.daysAtCurrentLevel > 14)
    .sort((a, b) => b.daysAtCurrentLevel - a.daysAtCurrentLevel)
    .slice(0, 20);

  const maxHeat = Math.max(...heatmapData.map(c => c.value));
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hours = ['9AM', '10AM', '11AM', '12PM', '1PM', '2PM', '3PM', '4PM'];

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

  return (
    <div className="space-y-6" id="bottleneck-report">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {bottleneckData.map((bn, i) => (
          <motion.div
            key={bn.level}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="glass-card-hover p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-gray-300">{bn.level}</h4>
              <div className={`w-3 h-3 rounded-full ${bn.stuckCount > 50 ? 'bg-red-500' : bn.stuckCount > 25 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            </div>
            <p className="text-3xl font-bold text-white">{bn.stuckCount}</p>
            <p className="text-xs text-gray-500 mt-1">stuck submissions</p>
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <Clock className="w-3 h-3 text-gray-500" />
                <span className="text-gray-400">Avg wait: <span className="text-white font-medium">{bn.avgWaitDays}d</span></span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <TrendingUp className="w-3 h-3 text-gray-500" />
                <span className="text-gray-400">Longest: <span className="text-red-400 font-medium">{bn.longestWaitDays}d</span></span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Average Wait by Level */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-card p-6" id="avg-wait-chart">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Average Wait Time by Level</h3>
            <button onClick={() => exportChartAsPng('avg-wait-chart', 'avg-wait')} className="p-1.5 rounded-lg hover:bg-navy-light/30 text-gray-500 hover:text-gold">
              <Download className="w-4 h-4" />
            </button>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={bottleneckData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#243656" />
              <XAxis dataKey="level" tick={{ fill: '#9CA3AF', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9CA3AF', fontSize: 12 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="avgWaitDays" fill="#D4A843" radius={[8, 8, 0, 0]} name="Avg Days" />
              <Bar dataKey="longestWaitDays" fill="#EF4444" radius={[8, 8, 0, 0]} name="Longest Wait" />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Heatmap */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Approval Speed Heatmap</h3>
          <div className="space-y-1.5">
            <div className="flex gap-1.5 ml-12">
              {hours.map(h => <div key={h} className="flex-1 text-center text-xs text-gray-500">{h}</div>)}
            </div>
            {days.map(day => (
              <div key={day} className="flex items-center gap-1.5">
                <span className="w-10 text-right text-xs text-gray-500">{day}</span>
                {hours.map(hour => {
                  const cell = heatmapData.find(c => c.day === day && c.hour === hour);
                  const intensity = cell ? cell.value / maxHeat : 0;
                  return (
                    <div
                      key={`${day}-${hour}`}
                      className="flex-1 h-8 rounded-md transition-colors"
                      style={{
                        backgroundColor: intensity > 0.7
                          ? `rgba(212, 168, 67, ${0.3 + intensity * 0.7})`
                          : intensity > 0.3
                            ? `rgba(59, 130, 246, ${0.2 + intensity * 0.5})`
                            : `rgba(36, 54, 86, ${0.3 + intensity * 0.5})`,
                      }}
                      title={`${day} ${hour}: ${cell?.value || 0} approvals`}
                    />
                  );
                })}
              </div>
            ))}
            <div className="flex items-center justify-end gap-4 mt-3">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <div className="w-4 h-4 rounded bg-navy-light/50" /> Low
                <div className="w-4 h-4 rounded bg-blue-500/50" /> Medium
                <div className="w-4 h-4 rounded bg-gold/70" /> High
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Top Approvers with Longest Queues */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Top Approvers — Pending Queues</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {bottleneckData.map(bn => (
            <div key={bn.level} className="space-y-2">
              <h4 className="text-sm font-medium text-gold">{bn.level}</h4>
              {bn.topApprovers.length > 0 ? bn.topApprovers.slice(0, 3).map((ap, i) => (
                <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-navy-dark/50">
                  <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-xs text-gray-300">{ap.name}</span>
                  </div>
                  <span className="text-xs font-bold text-amber-400">{ap.pending}</span>
                </div>
              )) : <p className="text-xs text-gray-600">No data</p>}
            </div>
          ))}
        </div>
      </motion.div>

      {/* Stuck Forms Alert List */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <h3 className="text-lg font-semibold text-white">Stuck Forms Alert — Over 14 Days</h3>
          </div>
          <button onClick={() => exportBottleneckPdf('bottleneck-report', 'bottleneck-analysis')} className="btn-gold text-xs flex items-center gap-2">
            <Download className="w-3.5 h-3.5" /> Export PDF
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-navy-light/20">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase">Reference</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase">Title</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase">Level</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase">Days Stuck</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase">Department</th>
              </tr>
            </thead>
            <tbody>
              {stuckForms.map(sub => (
                <tr key={sub.id} className="border-b border-navy-light/10 hover:bg-navy-light/20">
                  <td className="px-4 py-2.5 text-sm font-mono text-gold">{sub.referenceNumber}</td>
                  <td className="px-4 py-2.5 text-sm text-white">{sub.title}</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/20 text-red-400">
                      Level {String(sub.currentApprovalLevel)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-sm font-bold text-red-400">{sub.daysAtCurrentLevel}d</td>
                  <td className="px-4 py-2.5 text-sm text-gray-400">{sub.submittedBy.department}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
